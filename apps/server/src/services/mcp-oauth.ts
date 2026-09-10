import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpHttpConfig } from "@nakama/core";
import { nanoid } from "@nakama/core";

/**
 * OAuth grant for one HTTP MCP server. It lives inside the server's config
 * blob, which `redactMcpConfig` narrows to `url` and `headers`, so tokens never
 * reach an API response.
 */
export interface McpOAuthGrant {
  /**
   * Origin the pending flow was started from. The token exchange has to send
   * back the exact `redirect_uri` the authorization request used, and the
   * callback request itself cannot be asked: it arrives from the provider.
   */
  callbackBaseUrl?: string;
  clientInformation?: OAuthClientInformationFull;
  codeVerifier?: string;
  state?: string;
  tokens?: OAuthTokens;
}

export type StoredMcpHttpConfig = McpHttpConfig & { oauth?: McpOAuthGrant };

function mcpOAuthCallbackPath(serverId: string): string {
  return `/v1/mcp/oauth/callback/${encodeURIComponent(serverId)}`;
}

export function readMcpOAuthGrant(config: unknown): McpOAuthGrant | undefined {
  if (typeof config !== "object" || config === null) {
    return;
  }

  const grant = (config as StoredMcpHttpConfig).oauth;

  return typeof grant === "object" && grant !== null ? grant : undefined;
}

/**
 * The client half of the MCP authorization spec, persisted per server record.
 *
 * Nakama is not the user agent, so `redirectToAuthorization` records the URL
 * instead of following it: the operator opens it in their own browser and the
 * provider lands back on `mcpOAuthCallbackPath`.
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
    return `${this.callbackBaseUrl.replace(/\/$/, "")}${mcpOAuthCallbackPath(this.serverId)}`;
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
    await this.update({
      clientInformation: clientInformation as OAuthClientInformationFull,
    });
  }

  tokens(): OAuthTokens | undefined {
    return this.grant.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // The grant is live now, so the one-shot authorization leftovers go.
    await this.update({ codeVerifier: undefined, state: undefined, tokens });
  }

  async state(): Promise<string> {
    const state = nanoid(32);
    await this.update({ callbackBaseUrl: this.callbackBaseUrl, state });

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

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl.toString();
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

    await this.update({
      ...(scope === "all" || scope === "client"
        ? { clientInformation: undefined }
        : {}),
      ...(scope === "all" || scope === "tokens" ? { tokens: undefined } : {}),
      ...(scope === "all" || scope === "verifier"
        ? { codeVerifier: undefined, state: undefined }
        : {}),
    });
  }

  /** The stored `state` is single use: it is spent by the callback. */
  matchesPendingState(state: string): boolean {
    return Boolean(this.grant.state) && this.grant.state === state;
  }

  private async update(patch: Partial<McpOAuthGrant>): Promise<void> {
    this.grant = { ...this.grant, ...patch };
    await this.persist(this.grant);
  }
}
