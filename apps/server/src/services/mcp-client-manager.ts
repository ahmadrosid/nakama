import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  CachedMcpToolSummary,
  McpHttpConfig,
  McpStdioConfig,
  McpTransport,
} from "@nakama/core";
import { getProfileSoulDir } from "@nakama/core";
import type { CachedMcpTool, StoredMcpServerRecord } from "@nakama/db";

interface ConnectedMcpClient {
  client: Client;
  transport: Transport;
}

export class McpClientManager {
  private readonly connections = new Map<string, ConnectedMcpClient>();

  isConnected(
    serverId: string,
    transport: McpTransport,
    profileId?: string,
    orgId?: string,
  ): boolean {
    return this.connections.has(connectionKey(serverId, transport, profileId, orgId));
  }

  getConnectedCount(): number {
    return this.connections.size;
  }

  async ensureConnected(
    server: StoredMcpServerRecord,
    orgId: string,
    profileId: string,
  ): Promise<void> {
    if (this.isConnected(server.id, server.transport, profileId, orgId)) {
      return;
    }

    await this.connect(server, { orgId, profileId });
  }

  async connect(
    server: StoredMcpServerRecord,
    options?: { orgId?: string; profileId?: string },
  ): Promise<CachedMcpTool[]> {
    const key = connectionKey(server.id, server.transport, options?.profileId, options?.orgId);
    await this.disconnectKey(key);

    const transport = createTransport(server.transport, server.config, options);
    const client = new Client({
      name: "nakama",
      version: "1.0.0",
    });

    await client.connect(transport);
    const result = await client.listTools();
    const tools = normalizeListedTools(result.tools);

    this.connections.set(key, { client, transport });

    return tools;
  }

  async disconnect(serverId: string): Promise<void> {
    const keys = [...this.connections.keys()].filter(
      (key) => key === serverId || key.startsWith(`${serverId}:`),
    );

    for (const key of keys) {
      await this.disconnectKey(key);
    }
  }

  async disconnectAll(): Promise<void> {
    const keys = [...this.connections.keys()];

    for (const key of keys) {
      await this.disconnectKey(key);
    }
  }

  async listTools(
    serverId: string,
    transport: McpTransport,
    profileId?: string,
  ): Promise<CachedMcpTool[]> {
    const client = this.requireClient(serverId, transport, profileId);
    const result = await client.listTools();
    return normalizeListedTools(result.tools);
  }

  async callTool(
    serverId: string,
    transport: McpTransport,
    toolName: string,
    input: unknown,
    profileId?: string,
    orgId?: string,
  ): Promise<unknown> {
    const client = this.requireClient(serverId, transport, profileId, orgId);
    const result = await client.callTool({
      name: toolName,
      arguments: asToolArguments(input),
    });

    if ("toolResult" in result) {
      return result.toolResult;
    }

    if (result.isError) {
      return {
        error: formatToolContent(result.content),
      };
    }

    if (result.structuredContent !== undefined) {
      return result.structuredContent;
    }

    return {
      content: result.content,
      text: formatToolContent(result.content),
    };
  }

  async testConnection(
    transport: McpTransport,
    config: unknown,
  ): Promise<CachedMcpTool[]> {
    const mcpTransport = createTransport(transport, config);
    const client = new Client({
      name: "nakama",
      version: "1.0.0",
    });

    try {
      await client.connect(mcpTransport);
      const result = await client.listTools();
      return normalizeListedTools(result.tools);
    } finally {
      try {
        await mcpTransport.close();
      } catch {
        // Ignore transport shutdown errors.
      }
    }
  }

  private requireClient(
    serverId: string,
    transport: McpTransport,
    profileId?: string,
    orgId?: string,
  ): Client {
    const connection = this.connections.get(connectionKey(serverId, transport, profileId, orgId));

    if (!connection) {
      throw new Error(`MCP server "${serverId}" is not connected.`);
    }

    return connection.client;
  }

  private async disconnectKey(key: string): Promise<void> {
    const connection = this.connections.get(key);

    if (!connection) {
      return;
    }

    this.connections.delete(key);

    try {
      await connection.transport.close();
    } catch {
      // Ignore transport shutdown errors.
    }
  }
}

function connectionKey(
  serverId: string,
  transport: McpTransport,
  profileId?: string,
  orgId?: string,
): string {
  if (transport === "stdio" && profileId && orgId) {
    return `${serverId}:${orgId}:${profileId}`;
  }

  return serverId;
}

function createTransport(
  transport: McpTransport,
  config: unknown,
  options?: { orgId?: string; profileId?: string },
): Transport {
  if (transport === "http") {
    const http = readHttpConfig(config);

    return new StreamableHTTPClientTransport(new URL(http.url), {
      requestInit: {
        headers: http.headers,
      },
    });
  }

  if (transport === "stdio") {
    const stdio = readStdioConfig(config);
    const cwd =
      options?.orgId && options?.profileId
        ? getProfileSoulDir(options.orgId, options.profileId)
        : undefined;

    return new StdioClientTransport({
      ...stdio,
      ...(cwd ? { cwd } : {}),
    });
  }

  throw new Error(`Unsupported MCP transport: ${transport}`);
}

function readStdioConfig(config: unknown): McpStdioConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("stdio MCP servers require config.command.");
  }

  const record = config as Record<string, unknown>;
  const command =
    typeof record.command === "string" && record.command.trim()
      ? record.command.trim()
      : null;

  if (!command) {
    throw new Error("stdio MCP servers require config.command.");
  }

  const args = readStringArray(record.args);
  const env = readStringRecord(record.env);

  return {
    command,
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
  };
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function readHttpConfig(config: unknown): McpHttpConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("HTTP MCP servers require config.url.");
  }

  const record = config as Record<string, unknown>;
  const url = typeof record.url === "string" && record.url.trim() ? record.url.trim() : null;

  if (!url) {
    throw new Error("HTTP MCP servers require config.url.");
  }

  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid MCP server URL: ${url}`);
  }

  return {
    url,
    headers: readStringRecord(record.headers),
  };
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      record[key] = entry;
    }
  }

  return Object.keys(record).length > 0 ? record : undefined;
}

function normalizeListedTools(
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>,
): CachedMcpTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description?.trim() || tool.name,
    inputSchema: tool.inputSchema,
  }));
}

function asToolArguments(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {};
}

function formatToolContent(
  content: Array<{ type: string; text?: string }> | undefined,
): string {
  if (!content || content.length === 0) {
    return "Tool completed with no content.";
  }

  return content
    .map((part) => {
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }

      return JSON.stringify(part);
    })
    .join("\n");
}

export function toCachedMcpToolSummaries(tools: CachedMcpTool[]): CachedMcpToolSummary[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
