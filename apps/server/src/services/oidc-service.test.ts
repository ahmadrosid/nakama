import { describe, expect, test } from "bun:test";
import {
  createHash,
  sign as cryptoSign,
  generateKeyPairSync,
} from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import { AuthService } from "./auth-service";
import { type OidcConfig, OidcService } from "./oidc-service";
import { OrgService } from "./org-service";

const ISSUER = "https://pocketid.example.com";

const CLIENT_ID = "nakama-web";

const WEB_ORIGIN = "http://localhost:4310";

function baseConfig(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    adminGroups: [],
    allowedDomains: [],
    autoProvision: true,
    clientId: CLIENT_ID,
    clientSecret: "secret-value",
    disablePasswordLogin: false,
    groupsClaim: "groups",
    issuerUrl: ISSUER,
    linkExistingAccounts: true,
    providerName: "Pocket ID",
    requireEmailVerified: true,
    scopes: "openid email profile",
    ...overrides,
  };
}

interface TestClaims {
  aud?: string | string[];
  azp?: string;
  email?: string;
  email_verified?: boolean | string;
  exp?: number;
  groups?: string[];
  iss?: string;
  name?: string;
  nonce?: string;
  sub?: string;
}

/**
 * A minimal OIDC provider: serves discovery + JWKS, signs id_tokens with a
 * throwaway RSA key, and records every token exchange so a test can assert
 * the PKCE verifier reached the provider.
 */
function fakeProvider(issuer = ISSUER) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key" };
  const tokenRequests: URLSearchParams[] = [];

  const fetchImpl = async (
    input: string | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = String(input);

    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        authorization_endpoint: `${issuer}/authorize`,
        issuer,
        jwks_uri: `${issuer}/jwks`,
        token_endpoint: `${issuer}/token`,
      });
    }

    if (url === `${issuer}/jwks`) {
      return Response.json({ keys: [jwk] });
    }

    if (url === `${issuer}/token`) {
      tokenRequests.push(new URLSearchParams(String(init?.body ?? "")));

      return Response.json({ access_token: "at", id_token: currentIdToken });
    }

    return new Response("not found", { status: 404 });
  };

  let currentIdToken = "";

  const signIdToken = (claims: TestClaims): string => {
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })
    ).toString("base64url");

    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");

    const signature = cryptoSign(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      privateKey
    ).toString("base64url");

    currentIdToken = `${header}.${payload}.${signature}`;

    return currentIdToken;
  };

  return { fetchImpl, signIdToken, tokenRequests };
}

function validClaims(
  subject: string,
  nonce: string,
  overrides: TestClaims = {}
) {
  return {
    aud: CLIENT_ID,
    email: `${subject}@example.com`,
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
    iss: ISSUER,
    name: `User ${subject}`,
    nonce,
    sub: subject,
    ...overrides,
  };
}

async function seedUser(
  databaseAdapter: DatabaseAdapter,
  id: string,
  email: string,
  isPlatformAdmin = false
): Promise<void> {
  const now = new Date().toISOString();
  await databaseAdapter.createUser({
    createdAt: now,
    email,
    id,
    isPlatformAdmin,
    name: email,
    passwordHash: "x",
    updatedAt: now,
  });
}

async function createService(
  configOverrides: Partial<OidcConfig> = {},
  provider = fakeProvider()
) {
  process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
    join(tmpdir(), "nakama-oidc-service-")
  );

  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const orgService = new OrgService(databaseAdapter, authService);
  const config = baseConfig(configOverrides);

  const service = new OidcService(
    { authService, databaseAdapter, fetch: provider.fetchImpl, orgService },
    config
  );

  return { authService, databaseAdapter, orgService, provider, service };
}

/**
 * Drive one authorize → callback round-trip: the service parks the state, the
 * fake provider signs an id_token carrying that state's nonce, and
 * completeLogin does the exchange and verification.
 */
async function loginOnce(
  service: OidcService,
  provider: ReturnType<typeof fakeProvider>,
  databaseAdapter: DatabaseAdapter,
  overrides: {
    claims?: TestClaims;
    subject?: string;
  } = {}
) {
  const subject = overrides.subject ?? "subject-1";
  const authorizeUrl = new URL(await service.beginLogin(WEB_ORIGIN));
  const state = authorizeUrl.searchParams.get("state")!;
  const nonce = authorizeUrl.searchParams.get("nonce")!;

  provider.signIdToken(validClaims(subject, nonce, overrides.claims ?? {}));

  const result = await service.completeLogin({ code: "auth-code", state });

  return { ...result, authorizeUrl, nonce, subject };
}

describe("OidcService.beginLogin", () => {
  test("builds the authorize URL and parks state, nonce and verifier", async () => {
    const { databaseAdapter, service } = await createService();

    const url = new URL(await service.beginLogin(WEB_ORIGIN));

    expect(url.origin).toBe(ISSUER);
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });
});

describe("OidcService.completeLogin", () => {
  test("rejects an unknown or consumed state", async () => {
    const { service } = await createService();

    await expect(
      service.completeLogin({ code: "x", state: "nope" })
    ).rejects.toMatchObject({ status: 400 });
  });

  test("state is single-use: a replayed callback fails", async () => {
    const { databaseAdapter, provider, service } = await createService();
    const first = await loginOnce(service, provider, databaseAdapter);

    expect(first.user.email).toBe("subject-1@example.com");

    await expect(
      service.completeLogin({
        code: "again",
        state: new URL(first.authorizeUrl).searchParams.get("state")!,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  test("auto-provisions a new account into the default org", async () => {
    const { databaseAdapter, orgService, provider, service } =
      await createService({ defaultOrgSlug: "acme" });

    void orgService;

    await seedUser(databaseAdapter, "user_founder", "founder@example.com");
    await databaseAdapter.upsertOrganization({
      createdAt: new Date().toISOString(),
      id: "org_acme",
      name: "Acme",
      slug: "acme",
      updatedAt: new Date().toISOString(),
    });

    const { user, webOrigin } = await loginOnce(
      service,
      provider,
      databaseAdapter
    );

    expect(webOrigin).toBe(WEB_ORIGIN);
    expect(user.email).toBe("subject-1@example.com");

    const orgs = await databaseAdapter.listUserOrganizations(user.id);
    expect(orgs.map((entry) => entry.organization.slug)).toContain("acme");

    const identity = await databaseAdapter.getUserOidcIdentity(
      ISSUER,
      "subject-1"
    );

    expect(identity?.userId).toBe(user.id);
  });

  test("the second login for the same subject reuses the account", async () => {
    const { databaseAdapter, provider, service } = await createService();

    const first = await loginOnce(service, provider, databaseAdapter, {
      subject: "repeat",
    });

    const second = await loginOnce(service, provider, databaseAdapter, {
      subject: "repeat",
    });

    expect(second.user.id).toBe(first.user.id);
    expect(await databaseAdapter.countHumanUsers()).toBe(1);
  });

  test("links an existing password account by verified email", async () => {
    const { databaseAdapter, provider, service } = await createService();
    await seedUser(databaseAdapter, "user_existing", "linkme@example.com");

    const { user } = await loginOnce(service, provider, databaseAdapter, {
      claims: { email: "linkme@example.com" },
      subject: "new-subject",
    });

    expect(user.id).toBe("user_existing");
    expect(
      (await databaseAdapter.getUserOidcIdentity(ISSUER, "new-subject"))?.userId
    ).toBe("user_existing");
  });

  test("refuses to link an existing account on an unverified email, even when verification is optional", async () => {
    const { databaseAdapter, provider, service } = await createService({
      requireEmailVerified: false,
    });

    await seedUser(databaseAdapter, "user_admin", "admin@example.com", true);

    await expect(
      loginOnce(service, provider, databaseAdapter, {
        claims: { email: "admin@example.com", email_verified: false },
        subject: "squatter",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await databaseAdapter.getUserOidcIdentity(ISSUER, "squatter")
    ).toBeNull();
  });

  test("an unverified email cannot claim a pending invite", async () => {
    const { databaseAdapter, provider, service } = await createService({
      defaultOrgSlug: "home",
      requireEmailVerified: false,
    });

    const now = new Date().toISOString();
    await seedUser(databaseAdapter, "user_founder", "founder@example.com");

    for (const [id, slug] of [
      ["org_home", "home"],
      ["org_other", "other"],
    ]) {
      await databaseAdapter.upsertOrganization({
        createdAt: now,
        id,
        name: slug,
        slug,
        updatedAt: now,
      });
    }

    await databaseAdapter.createOrgInvite({
      acceptedAt: null,
      createdAt: now,
      email: "invited@example.com",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: "invite_1",
      invitedByUserId: "user_founder",
      orgId: "org_other",
      revokedAt: null,
      role: "admin",
      tokenHash: "hash",
    });

    const { user } = await loginOnce(service, provider, databaseAdapter, {
      claims: { email: "invited@example.com", email_verified: false },
    });

    expect(await databaseAdapter.getOrgMember("org_other", user.id)).toBeNull();
    expect(
      (await databaseAdapter.getOrgMember("org_home", user.id))?.role
    ).toBe("member");
  });

  test("refuses to link an existing account when linking is off", async () => {
    const { databaseAdapter, provider, service } = await createService({
      linkExistingAccounts: false,
    });

    await seedUser(databaseAdapter, "user_nolink", "nolink@example.com");

    await expect(
      loginOnce(service, provider, databaseAdapter, {
        claims: { email: "nolink@example.com" },
        subject: "sub-nolink",
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  test("refuses provisioning when auto-provision is off", async () => {
    const { databaseAdapter, provider, service } = await createService({
      autoProvision: false,
    });

    await expect(
      loginOnce(service, provider, databaseAdapter)
    ).rejects.toMatchObject({ status: 403 });
  });

  test("refuses an unverified provider email", async () => {
    const { databaseAdapter, provider, service } = await createService();

    await expect(
      loginOnce(service, provider, databaseAdapter, {
        claims: { email_verified: false },
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  test("refuses an email outside the allowed domains", async () => {
    const { databaseAdapter, provider, service } = await createService({
      allowedDomains: ["example.com"],
    });

    await expect(
      loginOnce(service, provider, databaseAdapter, {
        claims: { email: "intruder@evil.test" },
      })
    ).rejects.toMatchObject({ status: 403 });

    // The domain is what follows the last "@".
    await expect(
      loginOnce(service, provider, databaseAdapter, {
        claims: { email: "user@example.com@evil.test" },
        subject: "two-ats",
      })
    ).rejects.toMatchObject({ status: 403 });

    // Subdomains of an allowed domain still pass.
    const { user } = await loginOnce(service, provider, databaseAdapter, {
      claims: { email: "user@team.example.com" },
      subject: "ok-domain",
    });

    expect(user.email).toBe("user@team.example.com");
  });

  test("admin groups set and refresh is_platform_admin", async () => {
    const { databaseAdapter, provider, service } = await createService({
      adminGroups: ["nakama-admins"],
      defaultOrgSlug: "acme",
    });

    // A founder keeps user_admin out of the test: the break-glass account is
    // never demoted by provider groups.
    await seedUser(
      databaseAdapter,
      "user_founder",
      "founder@example.com",
      true
    );
    await databaseAdapter.upsertOrganization({
      createdAt: new Date().toISOString(),
      id: "org_acme",
      name: "Acme",
      slug: "acme",
      updatedAt: new Date().toISOString(),
    });

    const { user } = await loginOnce(service, provider, databaseAdapter, {
      claims: { groups: ["nakama-admins", "devs"] },
    });

    expect((await databaseAdapter.getUserById(user.id))?.isPlatformAdmin).toBe(
      true
    );

    // Drop the group at the provider: the next SSO login demotes again.
    await loginOnce(service, provider, databaseAdapter, {
      claims: { groups: ["devs"] },
    });

    expect(
      (await databaseAdapter.getUserById(user.id))?.isPlatformAdmin
    ).toBeFalsy();
  });

  test("provider groups never demote the last active platform admin", async () => {
    const { databaseAdapter, provider, service } = await createService({
      adminGroups: ["nakama-admins"],
    });

    await seedUser(databaseAdapter, "user_only", "only@example.com", true);

    const { user } = await loginOnce(service, provider, databaseAdapter, {
      claims: { email: "only@example.com", groups: [] },
    });

    expect(user.isPlatformAdmin).toBe(true);
    expect(
      (await databaseAdapter.getUserById("user_only"))?.isPlatformAdmin
    ).toBe(true);
  });

  test("a multi-audience token without our azp is rejected", async () => {
    const { databaseAdapter, provider, service } = await createService();

    await expect(
      loginOnce(service, provider, databaseAdapter, {
        claims: { aud: [CLIENT_ID, "other-client"] },
      })
    ).rejects.toThrow("authorized party");

    await expect(
      loginOnce(service, provider, databaseAdapter, {
        claims: { azp: "other-client" },
      })
    ).rejects.toThrow("authorized party");

    const { user } = await loginOnce(service, provider, databaseAdapter, {
      claims: { aud: [CLIENT_ID, "other-client"], azp: CLIENT_ID },
    });

    expect(user.email).toBe("subject-1@example.com");
  });

  test("an https issuer may not list plain-http endpoints", async () => {
    const provider = fakeProvider();

    const { service } = await createService(
      {},
      {
        ...provider,
        fetchImpl: async (input, init) => {
          const response = await provider.fetchImpl(input, init);

          if (String(input).endsWith("/.well-known/openid-configuration")) {
            return Response.json({
              ...(await response.json()),
              token_endpoint: "http://pocketid.example.com/token",
            });
          }

          return response;
        },
      }
    );

    await expect(service.beginLogin(WEB_ORIGIN)).rejects.toThrow("non-https");
  });

  test("a token with the wrong nonce is rejected", async () => {
    const { databaseAdapter, provider, service } = await createService();
    const authorizeUrl = new URL(await service.beginLogin(WEB_ORIGIN));
    const state = authorizeUrl.searchParams.get("state")!;

    provider.signIdToken(validClaims("subject-1", "wrong-nonce"));

    await expect(service.completeLogin({ code: "x", state })).rejects.toThrow(
      Error
    );
    void databaseAdapter;
  });

  test("a token with the wrong issuer is rejected", async () => {
    const { databaseAdapter, provider, service } = await createService();
    const authorizeUrl = new URL(await service.beginLogin(WEB_ORIGIN));
    const state = authorizeUrl.searchParams.get("state")!;
    const nonce = authorizeUrl.searchParams.get("nonce")!;

    provider.signIdToken(
      validClaims("subject-1", nonce, { iss: "https://evil.example.com" })
    );

    await expect(service.completeLogin({ code: "x", state })).rejects.toThrow(
      Error
    );
    void databaseAdapter;
  });

  test("sends the PKCE verifier and credentials to the token endpoint", async () => {
    const { databaseAdapter, provider, service } = await createService();
    const authorizeUrl = new URL(await service.beginLogin(WEB_ORIGIN));
    const state = authorizeUrl.searchParams.get("state")!;
    const nonce = authorizeUrl.searchParams.get("nonce")!;
    const challenge = authorizeUrl.searchParams.get("code_challenge")!;

    provider.signIdToken(validClaims("subject-1", nonce));
    await service.completeLogin({ code: "auth-code", state });

    const request = provider.tokenRequests[0]!;
    expect(request.get("grant_type")).toBe("authorization_code");
    expect(request.get("code")).toBe("auth-code");
    expect(request.get("client_id")).toBe(CLIENT_ID);
    expect(request.get("redirect_uri")).toBe(
      `${WEB_ORIGIN}/v1/auth/oidc/callback`
    );

    // The verifier hashes to the challenge the provider saw at authorize time.
    expect(
      createHash("sha256")
        .update(request.get("code_verifier")!)
        .digest("base64url")
    ).toBe(challenge);
    void databaseAdapter;
  });
});
