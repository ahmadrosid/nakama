import { randomBytes } from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk";
import { executeToolCall } from "@nakama/agent";
import {
  type JsonSchema,
  readRuntimeServerUrl,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import { DEFAULT_SERVER_PORT } from "@nakama/core/runtime";
import { z } from "zod";
import { readRecord } from "../shared";
import { ACP_MCP_BRIDGE_SOURCE } from "./acp-mcp-bridge";

/**
 * Nakama tools reach an ACP agent over MCP. The agent starts a small stdio
 * bridge (acp-mcp-bridge.ts), and the bridge posts each JSON-RPC message to
 * POST /v1/acp-mcp/:token. The token is a secret that identifies one chat, so
 * the route can only run that chat's tools.
 */

const MCP_PROTOCOL_VERSION = "2025-06-18";

interface ToolAccess {
  context: ToolContext;
  tools: ToolDefinition[];
}

const accessByToken = new Map<string, ToolAccess>();

const tokenBySessionKey = new Map<string, string>();

function tokenFor(sessionKey: string): string {
  const existing = tokenBySessionKey.get(sessionKey);

  if (existing) {
    return existing;
  }

  const token = randomBytes(32).toString("hex");
  tokenBySessionKey.set(sessionKey, token);

  return token;
}

const NAKAMA_MCP_SERVER = "nakama";

/** The MCP server entry a new ACP session is created with. */
export function acpMcpServerFor(sessionKey: string): acp.McpServer {
  const baseUrl =
    readRuntimeServerUrl() ?? `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;

  return {
    args: ["-e", ACP_MCP_BRIDGE_SOURCE],
    command: process.execPath,
    env: [
      {
        name: "NAKAMA_ACP_MCP_URL",
        value: `${baseUrl}/v1/acp-mcp/${tokenFor(sessionKey)}`,
      },
    ],
    name: NAKAMA_MCP_SERVER,
  };
}

// Claude names the tool in the permission request's `_meta`, for example
// `mcp__nakama__search_files`.
const claudePermissionSchema = z.object({
  _meta: z.object({ claudeCode: z.object({ toolName: z.string() }) }),
});

/**
 * True when the agent asks to run one of this chat's Nakama tools over MCP.
 * Only those are approved; every other permission request is denied.
 */
export function isNakamaToolPermission(
  sessionKey: string,
  toolCall: acp.ToolCallUpdate
): boolean {
  const parsed = claudePermissionSchema.safeParse(toolCall);
  const token = tokenBySessionKey.get(sessionKey);
  const access = token ? accessByToken.get(token) : undefined;

  if (!(parsed.success && access)) {
    return false;
  }

  const requested = parsed.data._meta.claudeCode.toolName;

  return access.tools.some(
    (tool) => requested === `mcp__${NAKAMA_MCP_SERVER}__${tool.name}`
  );
}

/** Which tools and context the agent's MCP calls run with, for one chat. */
export function setAcpToolAccess(
  sessionKey: string,
  tools: ToolDefinition[],
  context: ToolContext
): void {
  accessByToken.set(tokenFor(sessionKey), { context, tools });
}

/**
 * A draft's agent keeps the token it was created with. When the draft becomes
 * a chat, the chat takes that token, so the agent's MCP calls still resolve.
 */
export function moveAcpToolAccess(fromKey: string, toKey: string): void {
  const token = tokenBySessionKey.get(fromKey);

  if (!token || tokenBySessionKey.has(toKey)) {
    return;
  }

  tokenBySessionKey.delete(fromKey);
  tokenBySessionKey.set(toKey, token);
}

/** A JSON-RPC message from the agent's stdio bridge. Parse it at the route before use. */
export const acpMcpRequestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.record(z.string(), z.json()).optional(),
});

export type AcpMcpRequest = z.infer<typeof acpMcpRequestSchema>;

/** The three result shapes this server returns. Each is an MCP method's reply. */
type McpResult =
  | {
      capabilities: { tools: Record<string, never> };
      protocolVersion: string;
      serverInfo: { name: string; version: string };
    }
  | {
      tools: Array<{
        description: string;
        inputSchema: JsonSchema;
        name: string;
      }>;
    }
  | {
      content: Array<{ text: string; type: "text" }>;
      isError: boolean;
    };

interface JsonRpcResponse {
  error?: { code: number; message: string };
  id: string | number | null;
  jsonrpc: "2.0";
  result?: McpResult;
}

export type AcpMcpReply =
  | { kind: "unknown" }
  | { kind: "accepted" }
  | { kind: "reply"; body: JsonRpcResponse };

const toolCallParamsSchema = z.object({
  arguments: z.record(z.string(), z.json()).optional(),
  name: z.string(),
});

/** Answers one MCP request from the agent for the chat that owns `token`. */
export async function handleAcpMcpRequest(
  token: string,
  request: AcpMcpRequest
): Promise<AcpMcpReply> {
  const access = accessByToken.get(token);

  if (!access) {
    return { kind: "unknown" };
  }

  // A message without an id is a notification, and it gets no reply.
  if (request.id === undefined) {
    return { kind: "accepted" };
  }

  switch (request.method) {
    case "initialize":
      return {
        body: rpcResult(request.id, {
          capabilities: { tools: {} },
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: { name: "nakama", version: "1.0.0" },
        }),
        kind: "reply",
      };

    case "tools/list":
      return {
        body: rpcResult(request.id, {
          tools: access.tools.map((tool) => ({
            description: tool.description,
            inputSchema: tool.parameters ?? { properties: {}, type: "object" },
            name: tool.name,
          })),
        }),
        kind: "reply",
      };

    case "tools/call":
      return {
        body: await callTool(request.id, request.params, access),
        kind: "reply",
      };

    default:
      return {
        body: rpcError(
          request.id,
          -32_601,
          `Unknown method: ${request.method}`
        ),
        kind: "reply",
      };
  }
}

async function callTool(
  id: string | number,
  params: AcpMcpRequest["params"],
  access: ToolAccess
): Promise<JsonRpcResponse> {
  const parsed = toolCallParamsSchema.safeParse(params);

  if (!parsed.success) {
    return rpcError(id, -32_602, "tools/call needs a tool name.");
  }

  const { arguments: args = {}, name } = parsed.data;

  if (!access.tools.some((tool) => tool.name === name)) {
    return rpcError(id, -32_602, `Unknown tool: ${name}`);
  }

  const result = await executeToolCall(
    access.tools,
    { arguments: args, id: String(id), name },
    access.context
  );

  const failed = readRecord(result).error !== undefined;

  return rpcResult(id, {
    content: [{ text: JSON.stringify(result), type: "text" }],
    isError: failed,
  });
}

function rpcResult(id: string | number, result: McpResult): JsonRpcResponse {
  return { id, jsonrpc: "2.0", result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string
): JsonRpcResponse {
  return { error: { code, message }, id, jsonrpc: "2.0" };
}
