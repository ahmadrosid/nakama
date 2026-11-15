import { timingSafeEqual } from "node:crypto";
import {
  discoverOAuthProtectedResourceMetadata,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthClientInformationFullSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpHttpConfig } from "@nakama/core";
import { nanoid } from "@nakama/core";
import type { StoredMcpServerRecord } from "@nakama/db";
import { z } from "zod";
import { fetchMcpRemote } from "./mcp-fetch";

/**
 * OAuth grant for one HTTP MCP server. It lives inside the server's config
 * blob, which `redactMcpConfig` narrows to `url` and `headers`, so tokens never
 * reach an API response.
 */
export interface McpOAuthGrant {
  authorizationStartedAt?: number;
  authorizationUrl?: string;
  /** The token exchange repeats the redirect URI used to start this flow. */
  callbackBaseUrl?: string;
  clientInformation?: OAuthClientInformationFull;
  codeVerifier?: string;
  state?: string;
  tokens?: OAuthTokens;
}

export type StoredMcpHttpConfig = McpHttpConfig & { oauth?: McpOAuthGrant };

const StoredOAuthConfigSchema = z.object({
  oauth: z
    .object({
      authorizationStartedAt: z.number().int().nonnegative().optional(),
      authorizationUrl: z.url().optional(),
      callbackBaseUrl: z.string().optional(),
      clientInformation: OAuthClientInformationFullSchema.optional(),
      codeVerifier: z.string().optional(),
      state: z.string().optional(),
      tokens: OAuthTokensSchema.optional(),
    })
    .optional(),
});

export function readMcpOAuthGrant(
  config: StoredMcpServerRecord["config"]
): McpOAuthGrant | undefined {
  const parsed = StoredOAuthConfigSchema.safeParse(config);

  return parsed.success ? parsed.data.oauth : undefined;
}

/** A stalled well-known endpoint must not hold a Test connection open (#326). */
const OAUTH_PROBE_TIMEOUT_MS = 5000;

const OAUTH_FLOW_TTL_MS = 10 * 60_000;

/**
 * Whether a server that refused us speaks OAuth, decided by the RFC 9728
 * metadata the MCP authorization spec requires it to publish. Reading it off
 * the error text instead would call every 401 an OAuth server, including a
 * plain bad API key.
 */
export async function serverAdvertisesOAuth(url: string): Promise<boolean> {
  try {
    await discoverOAuthProtectedResourceMetadata(
      url,
      undefined,
      (input, init) =>
        fetchMcpRemote(input, {
          ...init,
          signal: AbortSignal.timeout(OAUTH_PROBE_TIMEOUT_MS),
        })
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * The client half of the MCP authorization spec, persisted per server record.
 *
 * Nakama is not the user agent, so `redirectToAuthorization` records the URL
 * instead of following it: the operator opens it in their own browser and the
 * provider lands back on the callback route.
 */
export class McpServerOAuthProvider implements OAuthClientProvider {
  /** Set when the flow needs consent instead of returning tokens. */
  authorizationUrl: string | undefined;

  private grant: McpOAuthGrant;

  constructor(
    private readonly serverId: string,
    private readonly callbackBaseUrl: string,
    grant: McpOAuthGrant | undefined,
    private readonly persist: (grant: McpOAuthGrant) => Promise<void>
  ) {
    this.grant = { ...grant };
  }

  get redirectUrl(): string {
    return `${this.callbackBaseUrl.replace(/\/$/, "")}/v1/mcp/oauth/callback/${encodeURIComponent(this.serverId)}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Nakama",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [this.redirectUrl],
      response_types: ["code"],
    };
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return this.grant.clientInformation;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed
  ): Promise<void> {
    // SAFETY: The SDK supplies the mixed client record that it persists as full client information.
    await this.update({
      clientInformation: clientInformation as OAuthClientInformationFull,
    });
  }

  tokens(): OAuthTokens | undefined {
    return this.grant.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // The grant is live now, so the one-shot authorization leftovers go.
    await this.update({
      authorizationStartedAt: undefined,
      authorizationUrl: undefined,
      codeVerifier: undefined,
      state: undefined,
      tokens,
    });
  }

  async state(): Promise<string> {
    const state = nanoid(32);
    await this.update({
      authorizationStartedAt: Date.now(),
      authorizationUrl: undefined,
      callbackBaseUrl: this.callbackBaseUrl,
      codeVerifier: undefined,
      state,
      tokens: undefined,
    });

    return state;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.update({ codeVerifier });
  }

  codeVerifier(): string {
    const verifier = this.grant.codeVerifier;

    if (!verifier) {
      throw new Error("No MCP authorization is in progress for this server.");
    }

    return verifier;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.update({ authorizationUrl: authorizationUrl.toString() });
    this.authorizationUrl = authorizationUrl.toString();
  }

  pendingAuthorizationUrl(): string | undefined {
    const startedAt = this.grant.authorizationStartedAt;

    if (startedAt === undefined) {
      return;
    }

    const age = Date.now() - startedAt;

    if (
      this.grant.tokens ||
      !this.grant.state ||
      !this.grant.codeVerifier ||
      !this.grant.clientInformation ||
      this.grant.callbackBaseUrl?.replace(/\/$/, "") !==
        this.callbackBaseUrl.replace(/\/$/, "") ||
      age < 0 ||
      age >= OAUTH_FLOW_TTL_MS
    ) {
      return;
    }

    return this.grant.authorizationUrl;
  }

  /**
   * Called by the SDK when the server rejects what we hold. Without it a dead
   * refresh token would fail every later connect with no way back.
   */
  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery"
  ): Promise<void> {
    if (scope === "discovery") {
      return;
    }

    const all = scope === "all";

    const patch: Partial<McpOAuthGrant> = {
      authorizationStartedAt: undefined,
      authorizationUrl: undefined,
    };

    if (all || scope === "client") {
      patch.clientInformation = undefined;
    }

    if (all || scope === "tokens") {
      patch.tokens = undefined;
    }

    if (all || scope === "verifier") {
      patch.codeVerifier = undefined;
      patch.state = undefined;
    }

    await this.update(patch);
  }

  /** True once the provider has issued something worth refreshing. */
  hasTokens(): boolean {
    return Boolean(this.grant.tokens);
  }

  /** The stored `state` is single use: it is spent by the callback. */
  matchesPendingState(state: string): boolean {
    const pending = Buffer.from(this.grant.state ?? "");
    const given = Buffer.from(state);

    return (
      Boolean(this.pendingAuthorizationUrl()) &&
      pending.length > 0 &&
      pending.length === given.length &&
      timingSafeEqual(pending, given)
    );
  }

  private async update(patch: Partial<McpOAuthGrant>): Promise<void> {
    this.grant = { ...this.grant, ...patch };
    await this.persist(this.grant);
  }
}
