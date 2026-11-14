import { createPublicKey, randomBytes, randomUUID } from "node:crypto";
import { NakamaApiError } from "@nakama/core";
import type {
  DatabaseAdapter,
  StoredUserOidcIdentity,
  StoredUserRecord,
} from "@nakama/db";
import type { z } from "zod";
import type { AuthService } from "./auth-service";
import { loadOidcConfig, type OidcConfig } from "./oidc-config";
import {
  base64url,
  GroupsClaimSchema,
  IdTokenClaimsSchema,
  type JsonWebKey,
  JwksResponseSchema,
  JwtHeaderSchema,
  type OidcDiscovery,
  OidcDiscoverySchema,
  type OidcIdentityClaims,
  pkceChallenge,
  TokenResponseSchema,
  verifyForAlg,
} from "./oidc-jwt";
import type { OrgService } from "./org-service";

export type { OidcConfig };

export { loadOidcConfig };

export const OIDC_CALLBACK_PATH = "/v1/auth/oidc/callback";

const STATE_TTL_MS = 10 * 60 * 1000;

const DISCOVERY_TTL_MS = 10 * 60 * 1000;

const JWKS_TTL_MS = 10 * 60 * 1000;

const FIRST_USER_ID = "user_admin";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class OidcService {
  private discovery?: { expiresAt: number; value: OidcDiscovery };
  private jwks?: { expiresAt: number; keys: JsonWebKey[] };

  constructor(
    private readonly deps: {
      authService: AuthService;
      databaseAdapter: DatabaseAdapter;
      fetch?: FetchLike;
      orgService: OrgService;
    },
    readonly config: OidcConfig
  ) {}

  private get fetchImpl(): FetchLike {
    return this.deps.fetch ?? fetch;
  }

  /**
   * Build the provider authorization URL and park the one-time values the
   * callback needs. `webOrigin` is the vouched origin the browser started
   * from: it carries both the redirect_uri the provider returns to and the
   * place the callback sends the browser once it is signed in.
   */
  async beginLogin(webOrigin: string): Promise<string> {
    const now = Date.now();
    const state = base64url(randomBytes(32));
    const nonce = base64url(randomBytes(32));
    const codeVerifier = base64url(randomBytes(48));

    await this.deps.databaseAdapter.deleteExpiredOidcAuthStates(
      new Date(now).toISOString()
    );
    await this.deps.databaseAdapter.createOidcAuthState({
      codeVerifier,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + STATE_TTL_MS).toISOString(),
      nonce,
      state,
      webOrigin,
    });

    const discovery = await this.getDiscovery();
    const redirectUri = this.resolveRedirectUri(webOrigin);

    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("code_challenge", pkceChallenge(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.scopes);
    url.searchParams.set("state", state);

    return url.toString();
  }

  /**
   * Finish the redirect from the provider: consume the state, exchange the
   * code, verify the ID token, then link, provision or reuse the account.
   * Returns the user and the web origin to send the browser back to.
   */
  async completeLogin(input: {
    code: string;
    state: string;
  }): Promise<{ user: StoredUserRecord; webOrigin: string }> {
    const now = new Date();

    const stored = await this.deps.databaseAdapter.consumeOidcAuthState(
      input.state,
      now.toISOString()
    );

    if (!stored) {
      throw new NakamaApiError(
        "Sign-in state is missing or expired. Start again.",
        400
      );
    }

    const discovery = await this.getDiscovery();

    const tokens = await this.exchangeCode({
      code: input.code,
      codeVerifier: stored.codeVerifier,
      redirectUri: this.resolveRedirectUri(stored.webOrigin),
      tokenEndpoint: discovery.token_endpoint,
    });

    const claims = await this.verifyIdToken(
      tokens.id_token,
      stored.nonce,
      discovery
    );

    const identity = await this.resolveUser(claims, now);

    return { user: identity, webOrigin: stored.webOrigin };
  }

  resolveRedirectUri(webOrigin: string): string {
    return this.config.redirectUrl ?? `${webOrigin}${OIDC_CALLBACK_PATH}`;
  }

  private async getDiscovery(): Promise<OidcDiscovery> {
    if (this.discovery && this.discovery.expiresAt > Date.now()) {
      return this.discovery.value;
    }

    const response = await this.fetchImpl(
      `${this.config.issuerUrl}/.well-known/openid-configuration`
    );

    if (!response.ok) {
      throw new Error(
        `OIDC discovery failed (${response.status}) for ${this.config.issuerUrl}.`
      );
    }

    const parsed = OidcDiscoverySchema.safeParse(await response.json());

    if (!parsed.success) {
      throw new Error(
        `OIDC discovery document is invalid for ${this.config.issuerUrl}.`
      );
    }

    const document = parsed.data;

    if (document.issuer.replace(/\/+$/, "") !== this.config.issuerUrl) {
      throw new Error(
        `OIDC issuer mismatch: discovery says ${document.issuer}, configured ${this.config.issuerUrl}.`
      );
    }

    // An https issuer must not send the code, the client secret or the key
    // lookup over plain http. An http issuer (internal Docker host) is the
    // operator's explicit choice and is left alone.
    if (
      this.config.issuerUrl.startsWith("https:") &&
      [
        document.authorization_endpoint,
        document.jwks_uri,
        document.token_endpoint,
      ].some((endpoint) => !endpoint.startsWith("https://"))
    ) {
      throw new Error(
        "OIDC discovery lists a non-https endpoint for an https issuer."
      );
    }

    this.discovery = {
      expiresAt: Date.now() + DISCOVERY_TTL_MS,
      value: document,
    };

    return document;
  }

  private async getJwks(
    jwksUri: string,
    refresh = false
  ): Promise<JsonWebKey[]> {
    if (!refresh && this.jwks && this.jwks.expiresAt > Date.now()) {
      return this.jwks.keys;
    }

    const response = await this.fetchImpl(jwksUri);

    if (!response.ok) {
      throw new Error(`OIDC JWKS fetch failed (${response.status}).`);
    }

    const body = JwksResponseSchema.safeParse(await response.json());

    if (!body.success) {
      throw new Error("OIDC JWKS response has no keys.");
    }

    this.jwks = { expiresAt: Date.now() + JWKS_TTL_MS, keys: body.data.keys };

    return body.data.keys;
  }

  private async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    tokenEndpoint: string;
  }): Promise<{ id_token: string }> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    });

    const response = await this.fetchImpl(input.tokenEndpoint, {
      body: body.toString(),
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${this.config.clientId}:${this.config.clientSecret}`
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `OIDC token exchange failed (${response.status}). ${detail.slice(0, 200)}`
      );
    }

    const tokens = TokenResponseSchema.safeParse(await response.json());

    if (!(tokens.success && tokens.data.id_token)) {
      throw new Error("OIDC token response has no id_token.");
    }

    return { id_token: tokens.data.id_token };
  }

  private async verifyIdToken(
    idToken: string,
    expectedNonce: string,
    discovery: OidcDiscovery
  ): Promise<OidcIdentityClaims> {
    const parts = idToken.split(".");

    if (parts.length !== 3) {
      throw new Error("OIDC id_token is malformed.");
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    let header: z.infer<typeof JwtHeaderSchema>;
    let payload: z.infer<typeof IdTokenClaimsSchema>;

    try {
      header = JwtHeaderSchema.parse(
        JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"))
      );
      payload = IdTokenClaimsSchema.parse(
        JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
      );
    } catch {
      throw new Error("OIDC id_token is malformed.");
    }

    const signature = Buffer.from(signatureB64, "base64url");
    const signed = `${headerB64}.${payloadB64}`;

    await this.verifySignature({
      alg: header.alg ?? "",
      jwksUri: discovery.jwks_uri,
      kid: header.kid,
      signature,
      signed,
    });

    if (payload.iss?.replace(/\/+$/, "") !== this.config.issuerUrl) {
      throw new Error("OIDC id_token issuer mismatch.");
    }

    const audiences = Array.isArray(payload.aud)
      ? payload.aud
      : payload.aud
        ? [payload.aud]
        : [];

    if (!audiences.includes(this.config.clientId)) {
      throw new Error("OIDC id_token audience mismatch.");
    }

    // OIDC Core 3.1.3.7: a token for several audiences must name us as azp.
    if (
      (audiences.length > 1 || payload.azp !== undefined) &&
      payload.azp !== this.config.clientId
    ) {
      throw new Error("OIDC id_token authorized party mismatch.");
    }

    if (payload.exp === undefined || payload.exp * 1000 <= Date.now()) {
      throw new Error("OIDC id_token is expired.");
    }

    if (payload.nonce !== expectedNonce) {
      throw new Error("OIDC id_token nonce mismatch.");
    }

    if (!payload.sub) {
      throw new Error("OIDC id_token has no subject.");
    }

    const emailVerified =
      payload.email_verified === true || payload.email_verified === "true";

    const groups = GroupsClaimSchema.parse(payload[this.config.groupsClaim]);

    return {
      email: payload.email?.trim().toLowerCase() || null,
      emailVerified,
      groups,
      name: payload.name?.trim() || null,
      subject: payload.sub,
    };
  }

  private async verifySignature(input: {
    alg: string;
    jwksUri: string;
    kid?: string;
    signature: Buffer;
    signed: string;
  }): Promise<void> {
    for (const refresh of [false, true]) {
      const keys = await this.getJwks(input.jwksUri, refresh);

      const candidates = keys.filter((key) =>
        input.kid ? key.kid === input.kid : true
      );

      for (const jwk of candidates) {
        try {
          const key = createPublicKey({ format: "jwk", key: jwk });

          const valid = verifyForAlg(
            input.alg,
            key,
            input.signed,
            input.signature
          );

          if (valid) {
            return;
          }
        } catch {
          // Wrong key shape for this alg; try the next candidate.
        }
      }
    }

    throw new Error("OIDC id_token signature verification failed.");
  }

  /**
   * Map a verified identity to a local account: linked identities go straight
   * through, a verified email can auto-link to a password account, and only
   * then does provisioning create one. Every return path ends at a user that
   * is not disabled.
   */
  private async resolveUser(
    claims: OidcIdentityClaims,
    now: Date
  ): Promise<StoredUserRecord> {
    const { databaseAdapter, orgService } = this.deps;

    if (this.config.allowedDomains.length > 0) {
      // The domain is after the last "@": "a@allowed.com@evil.com" is evil.com.
      const domain =
        claims.email?.slice(claims.email.lastIndexOf("@") + 1).toLowerCase() ??
        "";

      if (
        !(
          claims.email &&
          this.config.allowedDomains.some(
            (allowed) => domain === allowed || domain.endsWith(`.${allowed}`)
          )
        )
      ) {
        throw new NakamaApiError(
          "This email domain is not allowed to sign in.",
          403
        );
      }
    }

    if (!claims.email) {
      throw new NakamaApiError(
        "The provider did not return an email address.",
        400
      );
    }

    if (this.config.requireEmailVerified && !claims.emailVerified) {
      throw new NakamaApiError(
        "The provider has not verified this email address.",
        403
      );
    }

    const identity = await databaseAdapter.getUserOidcIdentity(
      this.config.issuerUrl,
      claims.subject
    );

    const nowIso = now.toISOString();

    if (identity) {
      const user = await databaseAdapter.getUserById(identity.userId);

      if (!user) {
        throw new NakamaApiError("Linked account no longer exists.", 403);
      }

      if (user.disabledAt) {
        throw new NakamaApiError("Account disabled", 403);
      }

      if (identity.email !== claims.email) {
        await databaseAdapter.upsertUserOidcIdentity({
          ...identity,
          email: claims.email,
          updatedAt: nowIso,
        });
      }

      await this.applyAdminGroups(user, claims.groups, nowIso);

      return user;
    }

    let user = await databaseAdapter.getUserByEmail(claims.email);

    if (user) {
      if (user.disabledAt) {
        throw new NakamaApiError("Account disabled", 403);
      }

      if (!this.config.linkExistingAccounts) {
        throw new NakamaApiError(
          "An account with this email already exists. Ask an admin to link it.",
          409
        );
      }

      // Linking hands over an existing account (maybe an admin), so it trusts
      // the email only when the provider verified it, even with
      // NAKAMA_OIDC_REQUIRE_EMAIL_VERIFIED=false.
      if (!claims.emailVerified) {
        throw new NakamaApiError(
          "The provider has not verified this email address.",
          403
        );
      }
    } else {
      if (!this.config.autoProvision) {
        throw new NakamaApiError(
          "No account for this email. Ask an admin for an invite.",
          403
        );
      }

      user = (
        await orgService.provisionOidcUser({
          defaultOrgSlug: this.config.defaultOrgSlug,
          email: claims.email,
          emailVerified: claims.emailVerified,
          isPlatformAdmin: this.isAdminGroupMember(claims.groups),
          name: claims.name,
          passwordHash: await this.deps.authService.hashPassword(
            randomBytes(32).toString("hex")
          ),
        })
      ).user;
    }

    const record: StoredUserOidcIdentity = {
      createdAt: nowIso,
      email: claims.email,
      id: randomUUID(),
      issuer: this.config.issuerUrl,
      subject: claims.subject,
      updatedAt: nowIso,
      userId: user.id,
    };

    await databaseAdapter.upsertUserOidcIdentity(record);
    await this.applyAdminGroups(user, claims.groups, nowIso);

    return user;
  }

  private isAdminGroupMember(groups: string[]): boolean {
    return (
      this.config.adminGroups.length > 0 &&
      groups.some((group) => this.config.adminGroups.includes(group))
    );
  }

  /**
   * Provider groups decide `is_platform_admin` on every SSO login when
   * admin groups are configured — same refresh contract as Rustrak. The first
   * account (`user_admin`) is the break-glass and is never demoted.
   */
  private async applyAdminGroups(
    user: StoredUserRecord,
    groups: string[],
    nowIso: string
  ): Promise<void> {
    if (this.config.adminGroups.length === 0 || user.id === FIRST_USER_ID) {
      return;
    }

    const shouldBeAdmin = this.isAdminGroupMember(groups);

    // The adapter refuses to demote the last active platform admin.
    if (
      Boolean(user.isPlatformAdmin) !== shouldBeAdmin &&
      (await this.deps.databaseAdapter.updateUserPlatformAdmin(
        user.id,
        shouldBeAdmin,
        nowIso
      ))
    ) {
      user.isPlatformAdmin = shouldBeAdmin;
    }
  }
}
