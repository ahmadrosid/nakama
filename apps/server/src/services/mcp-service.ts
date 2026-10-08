import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  CreateMcpServerRequest,
  ListMcpServersResponse,
  McpHttpConfig,
  McpServerConfig,
  McpServerDetail,
  McpServerResponse,
  McpServerSummary,
  McpStdioConfig,
  McpTransport,
  ProfileRef,
  TestMcpServerResponse,
  UpdateMcpServerRequest,
} from "@nakama/core";
import { createId, NakamaApiError } from "@nakama/core";
import { isPreinstalledMcpServerId } from "@nakama/core/mcp/preinstalled";
import type {
  DatabaseAdapter,
  StoredMcpServerRecord,
  StoredProfileRecord,
} from "@nakama/db";
import {
  isMcpReconnectableError,
  type JsonValue,
  type McpClientManager,
  type McpToolArguments,
  toCachedMcpToolSummaries,
} from "./mcp-client-manager";
import {
  type McpOAuthGrant,
  McpServerOAuthProvider,
  readMcpOAuthGrant,
  type StoredMcpHttpConfig,
  serverAdvertisesOAuth,
} from "./mcp-oauth";

const INVALID_OAUTH_CALLBACK_MESSAGE =
  "This sign-in link is no longer valid. Start it again from the MCP page.";

const AUTHORIZATION_REQUIRED_MESSAGE =
  "This server signs in with a browser. Add it, then approve the sign-in to connect.";

export interface McpConnectOptions {
  /** Origin the OAuth callback is reachable at; omitted means no OAuth. */
  callbackBaseUrl?: string;
  /**
   * Whether this caller may start a fresh sign-in. False for startup and other
   * unattended reconnects: they should refresh a grant they already have, not
   * spend discovery on a link nobody will open, and not replace the state an
   * operator is in the middle of using.
   */
  reauthorize?: boolean;
}

function buildOAuthProvider(
  server: Pick<StoredMcpServerRecord, "config" | "id" | "transport">,
  options: McpConnectOptions,
  persist: (grant: McpOAuthGrant) => Promise<void>
): McpServerOAuthProvider | undefined {
  const grant = readMcpOAuthGrant(server.config);
  // A reconnect has no request to read an origin from; the grant remembers the
  // one it was issued for, and a token refresh needs no redirect anyway.
  const callbackBaseUrl = options.callbackBaseUrl ?? grant?.callbackBaseUrl;

  if (server.transport !== "http" || !callbackBaseUrl) {
    return;
  }

  const provider = new McpServerOAuthProvider(
    server.id,
    callbackBaseUrl,
    grant,
    persist
  );

  if (options.reauthorize === false && !provider.hasTokens()) {
    return;
  }

  return provider;
}

function withOAuthGrant(config: McpServerConfig, grant?: McpOAuthGrant) {
  if (!grant) {
    return config;
  }

  if (!("url" in config)) {
    throw new Error("OAuth grants require an HTTP MCP server config.");
  }

  return { ...config, oauth: grant };
}

export class McpService {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly manager: McpClientManager
  ) {}

  async listServers(): Promise<ListMcpServersResponse> {
    const servers = await this.db.listMcpServers();
    const profileCounts = await this.db.listMcpServerProfileCounts();

    return {
      servers: servers.map((server) =>
        toMcpServerSummary(
          this.withLiveStatus(server),
          profileCounts[server.id] ?? 0
        )
      ),
    };
  }

  async getServer(serverId: string): Promise<McpServerResponse> {
    const server = await this.requireServer(serverId);
    const profileCounts = await this.db.listMcpServerProfileCounts();

    return {
      server: toMcpServerDetail(
        this.withLiveStatus(server),
        profileCounts[serverId] ?? 0
      ),
    };
  }

  async createServer(
    request: CreateMcpServerRequest,
    options: McpConnectOptions = {}
  ): Promise<McpServerResponse> {
    const name = request.name.trim();

    if (!name) {
      throw invalidMcpServerRequest("MCP server name is required.");
    }

    const transport = normalizeTransport(request.transport);
    validateConfig(transport, request.config);

    const existing = await this.db.getMcpServerByName(name);

    if (existing) {
      throw new NakamaApiError(`MCP server already exists: ${name}`, 409);
    }

    const now = new Date().toISOString();

    let record: StoredMcpServerRecord = {
      cachedTools: [],
      config: request.config,
      createdAt: now,
      enabled: request.enabled ?? true,
      id: createId("mcp"),
      lastError: null,
      name,
      status: "disconnected",
      transport,
      updatedAt: now,
    };

    // Connect before persisting so a failed initial connection is a client
    // error (4xx) and never leaves a broken server row behind.
    if (request.connect !== false && record.enabled) {
      // A grant started here has no row to write to yet, so it is captured and
      // stored with the record below.
      let grant: McpOAuthGrant | undefined;

      const provider = buildOAuthProvider(record, options, async (next) => {
        grant = next;
      });

      try {
        const cachedTools = await this.manager.connect(
          record,
          provider ? { authProvider: provider } : undefined
        );

        record = { ...record, cachedTools, status: "connected" };
      } catch (error) {
        if (!provider?.authorizationUrl) {
          const message =
            error instanceof Error ? error.message : String(error);

          throw new NakamaApiError(
            `Could not connect MCP server "${name}": ${message}`,
            422
          );
        }

        // Authorization is a step, not a failure: keep the row so the callback
        // has something to complete, and say so in the status rather than
        // reporting a connection error the operator cannot fix by editing.
        record = {
          ...record,
          config: withOAuthGrant(record.config, grant),
          lastError: null,
          status: "needs_auth",
        };
        await this.db.upsertMcpServer(record);

        return {
          authorizationUrl: provider.authorizationUrl,
          server: toMcpServerDetail(record),
        };
      }
    }

    await this.db.upsertMcpServer(record);

    return { server: toMcpServerDetail(record) };
  }

  async updateServer(
    serverId: string,
    request: UpdateMcpServerRequest
  ): Promise<McpServerResponse> {
    const server = await this.requireServer(serverId);
    const nextName = request.name?.trim() ?? server.name;

    if (!nextName) {
      throw new Error("MCP server name is required.");
    }

    if (nextName !== server.name) {
      const existing = await this.db.getMcpServerByName(nextName);

      if (existing && existing.id !== serverId) {
        throw new Error(`MCP server already exists: ${nextName}`);
      }
    }

    const transportChanged =
      request.transport !== undefined && request.transport !== server.transport;

    const transport = request.transport ?? server.transport;

    const config = request.config
      ? transportChanged
        ? request.config
        : mergeMcpConfig(
            transport,
            resolveMcpConfig(server.transport, server.config),
            request.config
          )
      : resolveMcpConfig(server.transport, server.config);

    if (request.transport !== undefined) {
      validateTransport(transport);
    }

    validateConfig(transport, config);

    const updated: StoredMcpServerRecord = {
      ...server,
      config,
      enabled: request.enabled ?? server.enabled,
      name: nextName,
      transport,
      updatedAt: new Date().toISOString(),
    };

    const configChanged =
      JSON.stringify(server.config) !== JSON.stringify(config) ||
      server.transport !== transport;

    const enabledChanged = updated.enabled !== server.enabled;

    if (configChanged || enabledChanged) {
      await this.manager.disconnect(serverId);
      updated.status = "disconnected";
      updated.lastError = null;
    }

    await this.db.upsertMcpServer(updated);

    return this.getServer(serverId);
  }

  async deleteServer(serverId: string, force = false): Promise<void> {
    const server = await this.requireServer(serverId);

    if (isPreinstalledMcpServerId(server.id)) {
      throw new Error(
        `Preinstalled MCP server "${server.name}" cannot be deleted.`
      );
    }

    const profiles = await this.db.listProfilesForMcpServer(serverId);

    if (profiles.length > 0 && !force) {
      const profileRefs = toProfileRefs(profiles);
      throw new NakamaApiError(
        formatMcpServerInUseMessage(profileRefs),
        409,
        undefined,
        profileRefs
      );
    }

    await this.manager.disconnect(serverId);

    const deleted = await this.db.deleteMcpServer(serverId);

    if (!deleted) {
      throw new Error("MCP server not found.");
    }
  }

  async connectServer(
    serverId: string,
    options: McpConnectOptions = {}
  ): Promise<McpServerResponse> {
    const server = await this.requireServer(serverId);

    if (!server.enabled) {
      throw new Error(`MCP server "${server.name}" is disabled.`);
    }

    const provider = buildOAuthProvider(server, options, (grant) =>
      this.saveOAuthGrant(serverId, grant)
    );

    try {
      const cachedTools = await this.manager.connect(
        server,
        provider ? { authProvider: provider } : undefined
      );

      const updated: StoredMcpServerRecord = {
        ...server,
        cachedTools,
        lastError: null,
        status: "connected",
        updatedAt: new Date().toISOString(),
      };

      await this.db.upsertMcpServer(updated);

      return { server: toMcpServerDetail(updated) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const authorizationUrl = provider?.authorizationUrl;
      // Re-read: the provider persisted the pending grant during the attempt,
      // and the record this method started from predates it.
      const stored = (await this.db.getMcpServer(serverId)) ?? server;

      const updated: StoredMcpServerRecord = {
        ...stored,
        lastError: authorizationUrl ? null : message,
        status: authorizationUrl ? "needs_auth" : "error",
        updatedAt: new Date().toISOString(),
      };

      await this.db.upsertMcpServer(updated);

      if (authorizationUrl) {
        return { authorizationUrl, server: toMcpServerDetail(updated) };
      }

      throw new Error(message);
    }
  }

  /**
   * Finishes the browser half of the flow: the provider redirected the operator
   * back with a code, which is exchanged for tokens before reconnecting.
   */
  async completeOAuth(
    serverId: string,
    options: { code: string; state: string; callbackBaseUrl: string }
  ): Promise<McpServerResponse> {
    // One message for a wrong id, a server that never started a flow and a
    // wrong state: this endpoint is public, so it says nothing about which
    // server ids exist.
    const server = await this.db.getMcpServer(serverId);

    if (!server || server.transport !== "http") {
      throw new NakamaApiError(INVALID_OAUTH_CALLBACK_MESSAGE, 400);
    }

    // The base the flow actually started from wins: the token exchange must
    // repeat that redirect_uri verbatim.
    const pending = readMcpOAuthGrant(server.config);
    const callbackBaseUrl = pending?.callbackBaseUrl ?? options.callbackBaseUrl;

    const provider = buildOAuthProvider(server, { callbackBaseUrl }, (grant) =>
      this.saveOAuthGrant(serverId, grant)
    );

    if (!provider?.matchesPendingState(options.state)) {
      throw new NakamaApiError(INVALID_OAUTH_CALLBACK_MESSAGE, 400);
    }

    const config = resolveMcpConfig("http", server.config);

    const result = await auth(provider, {
      authorizationCode: options.code,
      serverUrl: config.url,
    });

    if (result !== "AUTHORIZED") {
      throw new NakamaApiError("MCP authorization did not complete.", 400);
    }

    return this.connectServer(serverId, { callbackBaseUrl });
  }

  private async saveOAuthGrant(
    serverId: string,
    grant: McpOAuthGrant
  ): Promise<void> {
    const server = await this.db.getMcpServer(serverId);

    if (!server) {
      return;
    }

    await this.db.upsertMcpServer({
      ...server,
      config: withOAuthGrant(server.config, grant),
      updatedAt: new Date().toISOString(),
    });
  }

  async syncServer(
    serverId: string,
    options: McpConnectOptions = {}
  ): Promise<McpServerResponse> {
    await this.requireServer(serverId);
    await this.manager.disconnect(serverId);

    return this.connectServer(serverId, options);
  }

  async testServer(
    transport: McpTransport,
    config: McpServerConfig,
    serverId?: string
  ): Promise<TestMcpServerResponse> {
    const normalizedTransport = normalizeTransport(transport);

    const resolvedConfig = serverId
      ? mergeMcpConfig(
          normalizedTransport,
          resolveMcpConfig(
            normalizedTransport,
            (await this.requireServer(serverId)).config
          ),
          config
        )
      : config;

    validateConfig(normalizedTransport, resolvedConfig);

    try {
      const tools = await this.manager.testConnection(
        normalizedTransport,
        resolvedConfig
      );

      return {
        ok: true,
        toolCount: tools.length,
        tools: toCachedMcpToolSummaries(tools),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const requiresAuthorization =
        normalizedTransport === "http" &&
        "url" in resolvedConfig &&
        (await serverAdvertisesOAuth(resolvedConfig.url));

      const response: TestMcpServerResponse = {
        error: requiresAuthorization ? AUTHORIZATION_REQUIRED_MESSAGE : message,
        ok: false,
        toolCount: 0,
        tools: [],
      };

      if (requiresAuthorization) {
        response.requiresAuthorization = true;
      }

      return response;
    }
  }

  /**
   * Calls a tool on a profile's server, connecting first when the connection is
   * missing or has dropped. Retries once on a new connection when the server
   * did not run the request (for example it restarted and lost the session).
   */
  async callTool(
    server: StoredMcpServerRecord,
    toolName: string,
    input: McpToolArguments,
    orgId: string | undefined,
    profileId: string
  ): Promise<JsonValue> {
    const stdio = server.transport === "stdio";

    for (let attempt = 1; ; attempt++) {
      await this.ensureConnected(server, orgId, profileId);

      try {
        return await this.manager.callTool(
          server.id,
          server.transport,
          toolName,
          input,
          stdio ? profileId : undefined,
          stdio ? orgId : undefined
        );
      } catch (error) {
        if (attempt > 1 || !isMcpReconnectableError(error)) {
          throw error;
        }

        await this.manager.dropConnection(
          server.id,
          server.transport,
          stdio ? profileId : undefined,
          stdio ? orgId : undefined
        );
      }
    }
  }

  private async ensureConnected(
    server: StoredMcpServerRecord,
    orgId: string | undefined,
    profileId: string
  ): Promise<void> {
    if (server.transport === "stdio") {
      if (!orgId) {
        throw new Error("Profile organization is missing for stdio MCP.");
      }

      await this.manager.ensureConnected(server, orgId, profileId);

      return;
    }

    if (this.manager.isConnected(server.id, server.transport)) {
      return;
    }

    if (server.status === "needs_auth") {
      throw new Error(
        `MCP server "${server.name}" needs sign-in. Connect it on the MCP page.`
      );
    }

    await this.connectServer(server.id, { reauthorize: false });
  }

  /**
   * The stored status is written at connect time. An HTTP connection lives in
   * memory, so a restart or a dropped stream leaves the row saying connected.
   */
  private withLiveStatus(server: StoredMcpServerRecord): StoredMcpServerRecord {
    if (
      server.transport === "http" &&
      server.status === "connected" &&
      !this.manager.isConnected(server.id, server.transport)
    ) {
      return { ...server, status: "disconnected" };
    }

    return server;
  }

  async connectEnabledServers(options: McpConnectOptions = {}): Promise<void> {
    const servers = await this.db.listMcpServers();

    for (const server of servers) {
      if (!server.enabled || server.transport === "stdio") {
        // Stdio connections are profile-scoped; defer them until a profile
        // calls a tool.
        continue;
      }

      try {
        await this.connectServer(server.id, options);
      } catch (error) {
        console.warn(
          `Could not connect MCP server "${server.name}":`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  async assignServerToProfile(
    profileId: string,
    serverId: string
  ): Promise<void> {
    const profile = await this.db.getProfile(profileId);

    if (!profile) {
      throw new Error("Profile not found.");
    }

    await this.requireServer(serverId);
    await this.db.assignMcpServerToProfile(profileId, serverId);
  }

  async unassignServerFromProfile(
    profileId: string,
    serverId: string
  ): Promise<void> {
    const profile = await this.db.getProfile(profileId);

    if (!profile) {
      throw new Error("Profile not found.");
    }

    const removed = await this.db.unassignMcpServerFromProfile(
      profileId,
      serverId
    );

    if (!removed) {
      throw new Error("MCP server is not assigned to this profile.");
    }
  }

  async getStatusSummary(): Promise<{
    serverCount: number;
    connectedCount: number;
    assignedProfileCount: number;
  }> {
    const servers = await this.db.listMcpServers();

    return {
      assignedProfileCount: await this.db.countProfileMcpAssignments(),
      connectedCount: this.manager.getConnectedCount(),
      serverCount: servers.length,
    };
  }

  private async requireServer(
    serverId: string
  ): Promise<StoredMcpServerRecord> {
    const server = await this.db.getMcpServer(serverId);

    if (!server) {
      throw new Error("MCP server not found.");
    }

    return server;
  }
}

function toMcpServerSummary(
  server: StoredMcpServerRecord,
  assignedProfileCount?: number
): McpServerSummary {
  return {
    assignedProfileCount,
    createdAt: server.createdAt,
    enabled: server.enabled,
    id: server.id,
    lastError: server.lastError,
    name: server.name,
    status: server.status,
    toolCount: server.cachedTools.length,
    transport: server.transport,
    updatedAt: server.updatedAt,
  };
}

function toMcpServerDetail(
  server: StoredMcpServerRecord,
  assignedProfileCount?: number
): McpServerDetail {
  return {
    ...toMcpServerSummary(server, assignedProfileCount),
    cachedTools: toCachedMcpToolSummaries(server.cachedTools),
    config: redactMcpConfig(server.transport, server.config),
    usesOAuth: Boolean(readMcpOAuthGrant(server.config)),
  };
}

function toProfileRefs(profiles: StoredProfileRecord[]): ProfileRef[] {
  return profiles.map((profile) => ({ id: profile.id, name: profile.name }));
}

function formatMcpServerInUseMessage(profiles: ProfileRef[]): string {
  const names = profiles.map((profile) => profile.name).join(", ");

  if (profiles.length === 1) {
    return `MCP server is assigned to profile "${names}". Unassign it on the Profiles page before deleting.`;
  }

  return `MCP server is assigned to ${profiles.length} profiles (${names}). Unassign it from each profile before deleting.`;
}

const REDACTED_SECRET_VALUE = "••••••••";

function resolveMcpConfig<T>(
  transport: McpTransport,
  config: T
): McpServerConfig {
  const record = readUnknownRecord(config);

  if (transport === "http") {
    return {
      headers: readStringRecord(record?.headers),
      url: readString(record?.url) ?? "",
    };
  }

  return {
    args: readStringArray(record?.args),
    command: readString(record?.command) ?? "",
    env: readStringRecord(record?.env),
  };
}

function mergeMcpConfig(
  transport: McpTransport,
  previous: McpServerConfig,
  next: McpServerConfig
): McpServerConfig {
  if (transport === "http" && "url" in previous && "url" in next) {
    return mergeMcpHttpConfig(previous, next);
  }

  if ("command" in previous && "command" in next) {
    return mergeMcpStdioConfig(previous, next);
  }

  throw invalidMcpServerRequest("MCP server config does not match transport.");
}

function mergeMcpHttpConfig(
  previous: McpHttpConfig,
  next: McpHttpConfig
): StoredMcpHttpConfig {
  const url = next.url?.trim() || previous.url;
  // An OAuth grant belongs to one endpoint, so it survives every edit except
  // moving the server somewhere else.
  const grant = url === previous.url ? readMcpOAuthGrant(previous) : undefined;

  const merged: StoredMcpHttpConfig = {
    headers: mergeRedactedStringRecord(previous.headers, next.headers),
    url,
  };

  if (grant) {
    merged.oauth = grant;
  }

  return merged;
}

function mergeMcpStdioConfig(
  previous: McpStdioConfig,
  next: McpStdioConfig
): McpStdioConfig {
  const command = next.command?.trim() || previous.command;

  return {
    args:
      next.args === undefined ? previous.args : normalizeStringArray(next.args),
    command,
    env: mergeRedactedStringRecord(previous.env, next.env),
  };
}

function mergeRedactedStringRecord(
  previous: Record<string, string> | undefined,
  next: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!next) {
    return previous;
  }

  const previousRecord = previous ?? {};
  const merged: Record<string, string> = {};

  for (const [key, nextValue] of Object.entries(next)) {
    const trimmedKey = key.trim();

    if (!trimmedKey) {
      continue;
    }

    const trimmedValue = nextValue.trim();

    if (!trimmedValue) {
      if (trimmedKey in previousRecord) {
        merged[trimmedKey] = previousRecord[trimmedKey]!;
      }

      continue;
    }

    if (
      trimmedValue === REDACTED_SECRET_VALUE &&
      trimmedKey in previousRecord
    ) {
      merged[trimmedKey] = previousRecord[trimmedKey]!;
      continue;
    }

    merged[trimmedKey] = trimmedValue;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeStringArray(
  value: string[] | undefined
): string[] | undefined {
  if (!value) {
    return;
  }

  const items = value.map((entry) => entry.trim()).filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function redactMcpConfig<T>(
  transport: McpTransport,
  config: T
): McpServerConfig {
  const parsed = resolveMcpConfig(transport, config);

  if (transport === "stdio" && "command" in parsed) {
    return {
      args: parsed.args,
      command: parsed.command,
      env: redactStringRecord(parsed.env),
    };
  }

  if (!("url" in parsed)) {
    return { command: "" };
  }

  return {
    headers: redactStringRecord(parsed.headers),
    url: parsed.url,
  };
}

function redactStringRecord(
  value: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!value) {
    return;
  }

  const redacted: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = entry ? REDACTED_SECRET_VALUE : entry;
  }

  return redacted;
}

function invalidMcpServerRequest(message: string): NakamaApiError {
  return new NakamaApiError(message, 400);
}

function normalizeTransport(transport: string | undefined): McpTransport {
  const value = transport?.trim().toLowerCase();

  if (value === "http") {
    return "http";
  }

  if (value === "stdio" || value === "command") {
    return "stdio";
  }

  throw invalidMcpServerRequest('MCP transport must be "http" or "stdio".');
}

function validateTransport(
  transport: string
): asserts transport is McpTransport {
  normalizeTransport(transport);
}

function validateConfig(
  transport: McpTransport,
  config: McpServerConfig
): void {
  if (transport === "http") {
    const url = "url" in config ? config.url : undefined;

    if (!(isString(url) && url.trim())) {
      throw invalidMcpServerRequest("HTTP MCP servers require config.url.");
    }

    try {
      new URL(url);
    } catch {
      throw invalidMcpServerRequest(`Invalid MCP server URL: ${url}`);
    }

    return;
  }

  const command = "command" in config ? config.command : undefined;

  if (!(isString(command) && command.trim())) {
    throw invalidMcpServerRequest("stdio MCP servers require config.command.");
  }
}

function readUnknownRecord<T>(value: T): Map<string, unknown> | undefined {
  if (!(value instanceof Object)) {
    return;
  }

  return new Map(Object.entries(value));
}

function readString<T>(value: T): (T & string) | undefined {
  // SAFETY: The object tag check confirms the input uses the string representation.
  return Object.prototype.toString.call(value) === "[object String]"
    ? (value as T & string)
    : undefined;
}

function readStringRecord<T>(value: T): Record<string, string> | undefined {
  const record = readUnknownRecord(value);

  if (!record) {
    return;
  }

  const result: Record<string, string> = {};

  for (const [key, entry] of record) {
    const parsed = readString(entry);

    if (parsed !== undefined) {
      result[key] = parsed;
    }
  }

  return result;
}

function readStringArray<T>(value: T): string[] | undefined {
  if (!Array.isArray(value)) {
    return;
  }

  return value.flatMap((entry) => {
    const parsed = readString(entry);

    return parsed === undefined ? [] : [parsed];
  });
}

export function toMcpServerSummaries(
  servers: StoredMcpServerRecord[]
): McpServerSummary[] {
  return servers.map((server) => toMcpServerSummary(server));
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
