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
} from "@tinyclaw/core";
import { createId, TinyClawApiError } from "@tinyclaw/core";
import { isPreinstalledMcpServerId } from "@tinyclaw/core/mcp/preinstalled";
import type { CachedMcpTool, DatabaseAdapter, StoredMcpServerRecord, StoredProfileRecord } from "@tinyclaw/db";
import {
  McpClientManager,
  toCachedMcpToolSummaries,
} from "./mcp-client-manager";

export class McpService {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly manager: McpClientManager,
  ) {}

  async listServers(): Promise<ListMcpServersResponse> {
    const servers = await this.db.listMcpServers();
    const profileCounts = await this.db.listMcpServerProfileCounts();

    return {
      servers: servers.map((server) =>
        toMcpServerSummary(server, profileCounts[server.id] ?? 0),
      ),
    };
  }

  async getServer(serverId: string): Promise<McpServerResponse> {
    const server = await this.requireServer(serverId);
    const profileCounts = await this.db.listMcpServerProfileCounts();

    return { server: toMcpServerDetail(server, profileCounts[serverId] ?? 0) };
  }

  async createServer(request: CreateMcpServerRequest): Promise<McpServerResponse> {
    const name = request.name.trim();

    if (!name) {
      throw new Error("MCP server name is required.");
    }

    const transport = normalizeTransport(request.transport);
    validateConfig(transport, request.config);

    const existing = await this.db.getMcpServerByName(name);

    if (existing) {
      throw new Error(`MCP server already exists: ${name}`);
    }

    const now = new Date().toISOString();
    const record: StoredMcpServerRecord = {
      id: createId("mcp"),
      name,
      transport,
      config: request.config,
      enabled: request.enabled ?? true,
      status: "disconnected",
      lastError: null,
      cachedTools: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.db.upsertMcpServer(record);

    if (request.connect !== false && record.enabled) {
      await this.connectServer(record.id);
      return this.getServer(record.id);
    }

    return { server: toMcpServerDetail(record) };
  }

  async updateServer(
    serverId: string,
    request: UpdateMcpServerRequest,
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
            request.config,
          )
      : resolveMcpConfig(server.transport, server.config);

    if (request.transport !== undefined) {
      validateTransport(transport);
    }

    validateConfig(transport, config);

    const updated: StoredMcpServerRecord = {
      ...server,
      name: nextName,
      transport,
      config,
      enabled: request.enabled ?? server.enabled,
      updatedAt: new Date().toISOString(),
    };

    const configChanged =
      JSON.stringify(server.config) !== JSON.stringify(config) ||
      server.transport !== transport;

    if (configChanged) {
      await this.manager.disconnect(serverId);
      updated.status = "disconnected";
      updated.lastError = null;
    }

    await this.db.upsertMcpServer(updated);

    return this.getServer(serverId);
  }

  async deleteServer(serverId: string): Promise<void> {
    const server = await this.requireServer(serverId);

    if (isPreinstalledMcpServerId(server.id)) {
      throw new Error(`Preinstalled MCP server "${server.name}" cannot be deleted.`);
    }

    const profiles = await this.db.listProfilesForMcpServer(serverId);

    if (profiles.length > 0) {
      const profileRefs = toProfileRefs(profiles);
      throw new TinyClawApiError(
        formatMcpServerInUseMessage(profileRefs),
        409,
        undefined,
        profileRefs,
      );
    }

    await this.manager.disconnect(serverId);

    const deleted = await this.db.deleteMcpServer(serverId);

    if (!deleted) {
      throw new Error("MCP server not found.");
    }
  }

  async connectServer(serverId: string): Promise<McpServerResponse> {
    const server = await this.requireServer(serverId);

    if (!server.enabled) {
      throw new Error(`MCP server "${server.name}" is disabled.`);
    }

    try {
      const cachedTools = await this.manager.connect(server);
      const updated: StoredMcpServerRecord = {
        ...server,
        status: "connected",
        lastError: null,
        cachedTools,
        updatedAt: new Date().toISOString(),
      };

      await this.db.upsertMcpServer(updated);

      return { server: toMcpServerDetail(updated) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated: StoredMcpServerRecord = {
        ...server,
        status: "error",
        lastError: message,
        updatedAt: new Date().toISOString(),
      };

      await this.db.upsertMcpServer(updated);
      throw new Error(message);
    }
  }

  async syncServer(serverId: string): Promise<McpServerResponse> {
    const server = await this.requireServer(serverId);

    if (!this.manager.isConnected(serverId, server.transport)) {
      return this.connectServer(serverId);
    }

    try {
      const cachedTools = await this.manager.listTools(serverId, server.transport);
      const updated: StoredMcpServerRecord = {
        ...server,
        status: "connected",
        lastError: null,
        cachedTools,
        updatedAt: new Date().toISOString(),
      };

      await this.db.upsertMcpServer(updated);

      return { server: toMcpServerDetail(updated) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated: StoredMcpServerRecord = {
        ...server,
        status: "error",
        lastError: message,
        updatedAt: new Date().toISOString(),
      };

      await this.db.upsertMcpServer(updated);
      throw new Error(message);
    }
  }

  async testServer(
    transport: McpTransport,
    config: McpServerConfig,
    serverId?: string,
  ): Promise<TestMcpServerResponse> {
    const normalizedTransport = normalizeTransport(transport);
    const resolvedConfig = serverId
      ? mergeMcpConfig(
          normalizedTransport,
          resolveMcpConfig(
            normalizedTransport,
            (await this.requireServer(serverId)).config,
          ),
          config,
        )
      : config;

    validateConfig(normalizedTransport, resolvedConfig);

    try {
      const tools = await this.manager.testConnection(normalizedTransport, resolvedConfig);

      return {
        ok: true,
        toolCount: tools.length,
        tools: toCachedMcpToolSummaries(tools),
      };
    } catch (error) {
      return {
        ok: false,
        toolCount: 0,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async connectEnabledServers(): Promise<void> {
    const servers = await this.db.listMcpServers();

    for (const server of servers) {
      if (!server.enabled) {
        continue;
      }

      try {
        await this.connectServer(server.id);
      } catch (error) {
        console.warn(
          `Could not connect MCP server "${server.name}":`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  async assignServerToProfile(profileId: string, serverId: string): Promise<void> {
    const profile = await this.db.getProfile(profileId);

    if (!profile) {
      throw new Error("Profile not found.");
    }

    await this.requireServer(serverId);
    await this.db.assignMcpServerToProfile(profileId, serverId);
  }

  async unassignServerFromProfile(profileId: string, serverId: string): Promise<void> {
    const profile = await this.db.getProfile(profileId);

    if (!profile) {
      throw new Error("Profile not found.");
    }

    const removed = await this.db.unassignMcpServerFromProfile(profileId, serverId);

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
      serverCount: servers.length,
      connectedCount: this.manager.getConnectedCount(),
      assignedProfileCount: await this.db.countProfileMcpAssignments(),
    };
  }

  private async requireServer(serverId: string): Promise<StoredMcpServerRecord> {
    const server = await this.db.getMcpServer(serverId);

    if (!server) {
      throw new Error("MCP server not found.");
    }

    return server;
  }
}

function toMcpServerSummary(
  server: StoredMcpServerRecord,
  assignedProfileCount?: number,
): McpServerSummary {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    status: server.status,
    toolCount: server.cachedTools.length,
    assignedProfileCount,
    lastError: server.lastError,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

function toMcpServerDetail(
  server: StoredMcpServerRecord,
  assignedProfileCount?: number,
): McpServerDetail {
  return {
    ...toMcpServerSummary(server, assignedProfileCount),
    config: redactMcpConfig(server.transport, server.config),
    cachedTools: toCachedMcpToolSummaries(server.cachedTools),
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

function resolveMcpConfig(transport: McpTransport, config: unknown): McpServerConfig {
  if (typeof config !== "object" || config === null) {
    return transport === "http" ? { url: "" } : { command: "" };
  }

  return config as McpServerConfig;
}

function mergeMcpConfig(
  transport: McpTransport,
  previous: McpServerConfig,
  next: McpServerConfig,
): McpServerConfig {
  if (transport === "http") {
    return mergeMcpHttpConfig(previous as McpHttpConfig, next as McpHttpConfig);
  }

  return mergeMcpStdioConfig(previous as McpStdioConfig, next as McpStdioConfig);
}

function mergeMcpHttpConfig(previous: McpHttpConfig, next: McpHttpConfig): McpHttpConfig {
  const url = next.url?.trim() || previous.url;

  return {
    url,
    headers: mergeRedactedStringRecord(previous.headers, next.headers),
  };
}

function mergeMcpStdioConfig(previous: McpStdioConfig, next: McpStdioConfig): McpStdioConfig {
  const command = next.command?.trim() || previous.command;

  return {
    command,
    args: next.args !== undefined ? normalizeStringArray(next.args) : previous.args,
    env: mergeRedactedStringRecord(previous.env, next.env),
  };
}

function mergeRedactedStringRecord(
  previous: Record<string, string> | undefined,
  next: Record<string, string> | undefined,
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

    if (trimmedValue === REDACTED_SECRET_VALUE && trimmedKey in previousRecord) {
      merged[trimmedKey] = previousRecord[trimmedKey]!;
      continue;
    }

    merged[trimmedKey] = trimmedValue;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeStringArray(value: string[] | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const items = value.map((entry) => entry.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function redactMcpConfig(transport: McpTransport, config: unknown): McpServerConfig {
  if (transport === "stdio") {
    const stdio =
      typeof config === "object" && config !== null
        ? (config as McpStdioConfig)
        : { command: "" };

    return {
      command: stdio.command,
      args: stdio.args,
      env: redactStringRecord(stdio.env),
    };
  }

  const http =
    typeof config === "object" && config !== null
      ? (config as McpHttpConfig)
      : { url: "" };

  return {
    url: http.url,
    headers: redactStringRecord(http.headers),
  };
}

function redactStringRecord(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  const redacted: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = entry ? REDACTED_SECRET_VALUE : entry;
  }

  return redacted;
}

function normalizeTransport(transport: string | undefined): McpTransport {
  const value = transport?.trim().toLowerCase();

  if (value === "http") {
    return "http";
  }

  if (value === "stdio" || value === "command") {
    return "stdio";
  }

  throw new Error('MCP transport must be "http" or "stdio".');
}

function validateTransport(transport: string): asserts transport is McpTransport {
  normalizeTransport(transport);
}

function validateConfig(transport: McpTransport, config: unknown): void {
  if (typeof config !== "object" || config === null) {
    throw new Error("MCP server config is required.");
  }

  const record = config as Record<string, unknown>;

  if (transport === "http") {
    const url = record.url;

    if (typeof url !== "string" || !url.trim()) {
      throw new Error("HTTP MCP servers require config.url.");
    }

    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid MCP server URL: ${url}`);
    }

    return;
  }

  const command = record.command;

  if (typeof command !== "string" || !command.trim()) {
    throw new Error("stdio MCP servers require config.command.");
  }
}

export function toMcpServerSummaries(servers: StoredMcpServerRecord[]): McpServerSummary[] {
  return servers.map((server) => toMcpServerSummary(server));
}
