import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  CachedMcpToolSummary,
  McpHttpConfig,
  McpServerConfig,
  McpStdioConfig,
  McpTransport,
} from "@nakama/core";
import { getProfileSoulDir } from "@nakama/core";
import type { CachedMcpTool, StoredMcpServerRecord } from "@nakama/db";
import { z } from "zod";

/** A server that does not answer `initialize` must not hold a connect open. */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Long tools stay alive while they report progress. The SDK sends a progress
 * token only when `onprogress` is set.
 */
const CALL_TOOL_OPTIONS: RequestOptions = {
  onprogress: () => {},
  resetTimeoutOnProgress: true,
};

// Tool image limits, as pi's tool-result image pass: longest side and base64 size.
const MODEL_IMAGE_MAX_SIDE = 2000;

const MODEL_IMAGE_MAX_BASE64 = 4.5 * 1024 * 1024;

const MODEL_IMAGE_JPEG_QUALITIES = [80, 85, 70, 55, 40];

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type McpToolArguments = { [key: string]: JsonValue };

/** Thrown before a request is sent, so the caller can reconnect and retry. */
class McpNotConnectedError extends Error {}

/**
 * True when the server did not run the request: no client was connected, or
 * the server no longer knows the session (restart, deploy). A retry on a new
 * connection is safe. A tool call that failed any other way may have run.
 */
export function isMcpReconnectableError(cause: unknown): boolean {
  return (
    cause instanceof McpNotConnectedError ||
    (cause instanceof StreamableHTTPError && cause.code === 404)
  );
}

interface ConnectedMcpClient {
  client: Client;
  transport: Transport;
}

interface ConnectOptions {
  /** OAuth client for HTTP servers behind the MCP authorization spec. */
  authProvider?: OAuthClientProvider;
  orgId?: string;
  profileId?: string;
}

export class McpClientManager {
  private readonly connections = new Map<string, ConnectedMcpClient>();
  private readonly inflight = new Map<string, Promise<CachedMcpTool[]>>();

  isConnected(
    serverId: string,
    transport: McpTransport,
    profileId?: string,
    orgId?: string
  ): boolean {
    return this.connections.has(
      connectionKey(serverId, transport, profileId, orgId)
    );
  }

  getConnectedCount(): number {
    return this.connections.size;
  }

  async ensureConnected(
    server: StoredMcpServerRecord,
    orgId: string,
    profileId: string
  ): Promise<void> {
    const key = connectionKey(server.id, server.transport, profileId, orgId);

    if (this.connections.has(key)) {
      return;
    }

    const pending = this.inflight.get(key);

    if (pending) {
      await pending;

      // Disconnect may have run after the shared connect settled.
      if (this.connections.has(key)) {
        return;
      }
    }

    await this.connect(server, { orgId, profileId });
  }

  async connect(
    server: StoredMcpServerRecord,
    options?: ConnectOptions
  ): Promise<CachedMcpTool[]> {
    const key = connectionKey(
      server.id,
      server.transport,
      options?.profileId,
      options?.orgId
    );

    const pending = this.inflight.get(key);

    if (pending) {
      return pending;
    }

    const run = this.establishConnection(server, options, key);

    const tracked = run.finally(() => {
      if (this.inflight.get(key) === tracked) {
        this.inflight.delete(key);
      }
    });

    this.inflight.set(key, tracked);

    return tracked;
  }

  private async establishConnection(
    server: StoredMcpServerRecord,
    options: ConnectOptions | undefined,
    key: string
  ): Promise<CachedMcpTool[]> {
    await this.disconnectKey(key);

    const transport = createTransport(server.transport, server.config, options);

    const client = new Client({
      name: "nakama",
      version: "1.0.0",
    });

    let connectionStored = false;

    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });

      const result = await client.listTools(undefined, {
        timeout: CONNECT_TIMEOUT_MS,
      });

      const tools = normalizeListedTools(result.tools);

      this.store(key, client, transport);
      connectionStored = true;

      return tools;
    } finally {
      if (!connectionStored) {
        try {
          await transport.close();
        } catch {
          // Ignore transport shutdown errors.
        }
      }
    }
  }

  /**
   * Keeps a connection and forgets it when its transport closes (stdio process
   * exit, dropped stream), so the next call reconnects instead of failing on a
   * dead client.
   */
  private store(key: string, client: Client, transport: Transport): void {
    this.connections.set(key, { client, transport });
    client.onclose = () => {
      if (this.connections.get(key)?.client === client) {
        this.connections.delete(key);
      }
    };
  }

  /** Forgets a connection the server no longer accepts, so it reconnects. */
  async dropConnection(
    serverId: string,
    transport: McpTransport,
    profileId?: string,
    orgId?: string
  ): Promise<void> {
    await this.disconnectKey(
      connectionKey(serverId, transport, profileId, orgId)
    );
  }

  async disconnect(serverId: string): Promise<void> {
    const keys = [...this.connections.keys()].filter(
      (key) => key === serverId || key.startsWith(`${serverId}:`)
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
    profileId?: string
  ): Promise<CachedMcpTool[]> {
    const client = this.requireClient(serverId, transport, profileId);
    const result = await client.listTools();

    return normalizeListedTools(result.tools);
  }

  async callTool(
    serverId: string,
    transport: McpTransport,
    toolName: string,
    input: McpToolArguments,
    profileId?: string,
    orgId?: string
  ): Promise<JsonValue> {
    const client = this.requireClient(serverId, transport, profileId, orgId);

    const result = await client.callTool(
      {
        arguments: input,
        name: toolName,
      },
      undefined,
      CALL_TOOL_OPTIONS
    );

    if ("toolResult" in result) {
      return parseJsonValue(result.toolResult);
    }

    if (result.isError) {
      return {
        error: formatToolContent(result.content),
      };
    }

    if (result.structuredContent !== undefined) {
      return parseJsonValue(result.structuredContent);
    }

    return await formatToolContentResult(result.content);
  }

  async testConnection(
    transport: McpTransport,
    config: McpServerConfig
  ): Promise<CachedMcpTool[]> {
    const mcpTransport = createTransport(transport, config);

    const client = new Client({
      name: "nakama",
      version: "1.0.0",
    });

    try {
      await client.connect(mcpTransport, { timeout: CONNECT_TIMEOUT_MS });

      const result = await client.listTools(undefined, {
        timeout: CONNECT_TIMEOUT_MS,
      });

      return normalizeListedTools(result.tools);
    } finally {
      try {
        await mcpTransport.close();
      } catch {
        // Ignore transport shutdown errors.
      }
    }
  }

  async connectHttpEndpoint(
    connectionKey: string,
    url: string,
    headers?: Record<string, string>
  ): Promise<CachedMcpTool[]> {
    await this.disconnectKey(connectionKey);

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers,
      },
    });

    const client = new Client({
      name: "nakama",
      version: "1.0.0",
    });

    let connectionStored = false;

    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });

      const result = await client.listTools(undefined, {
        timeout: CONNECT_TIMEOUT_MS,
      });

      const tools = normalizeListedTools(result.tools);
      this.store(connectionKey, client, transport);
      connectionStored = true;

      return tools;
    } finally {
      if (!connectionStored) {
        try {
          await transport.close();
        } catch {
          // Ignore transport shutdown errors.
        }
      }
    }
  }

  isHttpEndpointConnected(connectionKey: string): boolean {
    return this.connections.has(connectionKey);
  }

  async callHttpEndpointTool(
    connectionKey: string,
    toolName: string,
    input: McpToolArguments
  ): Promise<JsonValue> {
    const client = this.requireClientByKey(connectionKey);

    const result = await client.callTool(
      {
        arguments: input,
        name: toolName,
      },
      undefined,
      CALL_TOOL_OPTIONS
    );

    if ("toolResult" in result) {
      return parseJsonValue(result.toolResult);
    }

    if (result.isError) {
      return {
        error: formatToolContent(result.content),
      };
    }

    if (result.structuredContent !== undefined) {
      return parseJsonValue(result.structuredContent);
    }

    return await formatToolContentResult(result.content);
  }

  async disconnectHttpEndpoint(connectionKey: string): Promise<void> {
    await this.disconnectKey(connectionKey);
  }

  private requireClientByKey(connectionKey: string): Client {
    const connection = this.connections.get(connectionKey);

    if (!connection) {
      throw new McpNotConnectedError(
        `HTTP MCP endpoint "${connectionKey}" is not connected.`
      );
    }

    return connection.client;
  }

  private requireClient(
    serverId: string,
    transport: McpTransport,
    profileId?: string,
    orgId?: string
  ): Client {
    const connection = this.connections.get(
      connectionKey(serverId, transport, profileId, orgId)
    );

    if (!connection) {
      throw new McpNotConnectedError(
        `MCP server "${serverId}" is not connected.`
      );
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
  orgId?: string
): string {
  if (transport === "stdio" && profileId && orgId) {
    return `${serverId}:${orgId}:${profileId}`;
  }

  return serverId;
}

function createTransport(
  transport: McpTransport,
  config: StoredMcpServerRecord["config"],
  options?: ConnectOptions
): Transport {
  if (transport === "http") {
    const http = readHttpConfig(config);

    const requestInit = { headers: http.headers };

    return new StreamableHTTPClientTransport(
      new URL(http.url),
      options?.authProvider
        ? { authProvider: options.authProvider, requestInit }
        : { requestInit }
    );
  }

  if (transport === "stdio") {
    const stdio = readStdioConfig(config);

    const cwd =
      options?.orgId && options?.profileId
        ? getProfileSoulDir(options.orgId, options.profileId)
        : undefined;

    return new StdioClientTransport({ ...stdio, cwd });
  }

  throw new Error(`Unsupported MCP transport: ${transport}`);
}

function readStdioConfig(
  value: StoredMcpServerRecord["config"]
): McpStdioConfig {
  const config = z
    .object({
      args: z.array(z.string()).optional(),
      command: z.string(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .parse(value);

  const command = config.command.trim();

  if (!command) {
    throw new Error("stdio MCP servers require config.command.");
  }

  const result: McpStdioConfig = { command };

  if (config.args) {
    result.args = config.args;
  }

  if (config.env) {
    result.env = config.env;
  }

  return result;
}

function readHttpConfig(value: StoredMcpServerRecord["config"]): McpHttpConfig {
  const config = z
    .object({
      headers: z.record(z.string(), z.string()).optional(),
      url: z.string(),
    })
    .parse(value);

  const url = config.url.trim();

  if (!url) {
    throw new Error("HTTP MCP servers require config.url.");
  }

  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid MCP server URL: ${url}`);
  }

  return {
    headers: config.headers,
    url,
  };
}

function normalizeListedTools(
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>
): CachedMcpTool[] {
  return tools.map((tool) => ({
    description: tool.description?.trim() || tool.name,
    inputSchema: tool.inputSchema,
    name: tool.name,
  }));
}

export function parseMcpToolArguments<T>(input: T) {
  if (!(input instanceof Object) || Array.isArray(input)) {
    return {};
  }

  const entries: Array<[string, JsonValue]> = [];

  for (const [key, value] of Object.entries(input)) {
    if (!isJsonValue(value)) {
      throw new Error("MCP tool arguments must contain JSON values.");
    }

    entries.push([key, value]);
  }

  return Object.fromEntries(entries);
}

function parseJsonValue<T>(value: T): JsonValue {
  if (!isJsonValue(value)) {
    throw new Error("MCP tool result is not a JSON value.");
  }

  return value;
}

function isJsonValue<T>(
  value: T,
  seen = new WeakSet<object>()
): value is T & JsonValue {
  if (value === null || value === true || value === false || isString(value)) {
    return true;
  }

  if (
    Object.prototype.toString.call(value) === "[object Number]" &&
    !(value instanceof Number)
  ) {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }

    seen.add(value);
    const valid = value.every((entry) => isJsonValue(entry, seen));
    seen.delete(value);

    return valid;
  }

  if (!(value instanceof Object) || seen.has(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  seen.add(value);
  const valid = Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);

  return valid;
}

interface McpContentPart {
  data?: string;
  mimeType?: string;
  text?: string;
  type: string;
}

interface ModelImage {
  data: string;
  mediaType: string;
  note?: string;
}

/**
 * Images go out as `images`, which the chat loop sends to the model as image
 * input. Inline base64 reached the model as text: one screenshot was ~1M tokens.
 */
async function formatToolContentResult(
  content: McpContentPart[]
): Promise<JsonValue> {
  const images: JsonValue[] = [];
  const parts: JsonValue[] = [];
  const notes: string[] = [];

  for (const part of content) {
    if (
      part.type === "image" &&
      isString(part.data) &&
      isString(part.mimeType)
    ) {
      const { note, ...image } = await fitImageForModel(
        part.data,
        part.mimeType
      );

      images.push(image);
      parts.push({ mimeType: image.mediaType, type: "image" });

      if (note) {
        parts.push({ text: note, type: "text" });
        notes.push(note);
      }

      continue;
    }

    parts.push(parseJsonValue(part));
  }

  const text = [formatToolContent(content), ...notes].join("\n");

  return images.length > 0
    ? { content: parts, images, text }
    : { content: parts, text };
}

/** Scale down and re-encode until the image fits; PNG first, then JPEG. */
async function fitImageForModel(
  data: string,
  mimeType: string
): Promise<ModelImage> {
  try {
    const bytes = Buffer.from(data, "base64");
    const { height, width } = await new Bun.Image(bytes).metadata();

    if (
      width <= MODEL_IMAGE_MAX_SIDE &&
      height <= MODEL_IMAGE_MAX_SIDE &&
      data.length < MODEL_IMAGE_MAX_BASE64
    ) {
      return { data, mediaType: mimeType };
    }

    const scale = Math.min(1, MODEL_IMAGE_MAX_SIDE / Math.max(width, height));
    let targetWidth = Math.max(1, Math.round(width * scale));
    let targetHeight = Math.max(1, Math.round(height * scale));

    while (true) {
      const resized = () =>
        new Bun.Image(bytes).resize(targetWidth, targetHeight, {
          fit: "fill",
        });

      const encodings: Array<[string, () => Promise<Uint8Array>]> = [
        ["image/png", () => resized().png().bytes()],
        ...MODEL_IMAGE_JPEG_QUALITIES.map(
          (quality): [string, () => Promise<Uint8Array>] => [
            "image/jpeg",
            () => resized().jpeg({ quality }).bytes(),
          ]
        ),
      ];

      for (const [mediaType, encode] of encodings) {
        const encoded = Buffer.from(await encode()).toString("base64");

        if (encoded.length < MODEL_IMAGE_MAX_BASE64) {
          return {
            data: encoded,
            mediaType,
            note: `[Image: original ${width}x${height}, displayed at ${targetWidth}x${targetHeight}. Multiply coordinates by ${(width / targetWidth).toFixed(2)} to map to original image.]`,
          };
        }
      }

      if (targetWidth === 1 && targetHeight === 1) {
        return { data, mediaType: mimeType };
      }

      targetWidth = Math.max(1, Math.floor(targetWidth * 0.75));
      targetHeight = Math.max(1, Math.floor(targetHeight * 0.75));
    }
  } catch {
    // A format Bun cannot decode goes out as the tool sent it.
    return { data, mediaType: mimeType };
  }
}

function formatToolContent(content: McpContentPart[] | undefined): string {
  if (!content || content.length === 0) {
    return "Tool completed with no content.";
  }

  return content
    .map((part) => {
      if (part.type === "text" && isString(part.text)) {
        return part.text;
      }

      if (part.type === "image") {
        return `[${part.mimeType ?? "image"}]`;
      }

      return JSON.stringify(part);
    })
    .join("\n");
}

export function toCachedMcpToolSummaries(
  tools: CachedMcpTool[]
): CachedMcpToolSummary[] {
  return tools.map((tool) => ({
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
  }));
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
