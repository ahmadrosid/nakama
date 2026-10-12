import { afterEach, describe, expect, test } from "bun:test";
import type { JsonSchema, ToolContext, ToolDefinition } from "@nakama/core";
import { ACP_MCP_BRIDGE_SOURCE } from "./acp-mcp-bridge";
import {
  acpMcpRequestSchema,
  acpMcpServerFor,
  handleAcpMcpRequest,
  setAcpToolAccess,
} from "./acp-mcp-tools";

const echoParameters: JsonSchema = {
  properties: { text: { type: "string" } },
  required: ["text"],
  type: "object",
};

const echoTool: ToolDefinition = {
  description: "Echo the text back",
  name: "echo_tool",
  parameters: echoParameters,
  run: async (input) => {
    // SAFETY: The tool's parameters schema requires a string `text` (see above).
    const { text } = input as { text: string };

    return { echoed: text };
  },
};

const context: ToolContext = {};

let keyCounter = 0;

function freshSession() {
  keyCounter += 1;
  const key = `mcp-test-${keyCounter}`;
  const entry = acpMcpServerFor(key);
  // The entry is always the stdio form, which is the only one with an env list.
  const value = "env" in entry ? (entry.env[0]?.value ?? "") : "";
  const url = new URL(value);
  const token = url.pathname.split("/").pop() ?? "";

  return { key, token, url };
}

const servers: Array<{ stop(): void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
});

describe("ACP MCP tools", () => {
  test("lists and runs the chat's tools for the token that owns them", async () => {
    const session = freshSession();
    setAcpToolAccess(session.key, [echoTool], context);

    const list = await handleAcpMcpRequest(session.token, {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/list",
    });

    const call = await handleAcpMcpRequest(session.token, {
      id: 2,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: { text: "hi" }, name: "echo_tool" },
    });

    expect(list).toEqual({
      body: {
        id: 1,
        jsonrpc: "2.0",
        result: {
          tools: [
            {
              description: "Echo the text back",
              inputSchema: echoParameters,
              name: "echo_tool",
            },
          ],
        },
      },
      kind: "reply",
    });
    expect(call).toEqual({
      body: {
        id: 2,
        jsonrpc: "2.0",
        result: {
          content: [{ text: '{"echoed":"hi"}', type: "text" }],
          isError: false,
        },
      },
      kind: "reply",
    });
  });

  test("refuses a token that no chat owns", async () => {
    const reply = await handleAcpMcpRequest("not-a-real-token", {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/list",
    });

    expect(reply).toEqual({ kind: "unknown" });
  });

  test("does not run a tool the chat was not given", async () => {
    const session = freshSession();
    setAcpToolAccess(session.key, [echoTool], context);

    const reply = await handleAcpMcpRequest(session.token, {
      id: 3,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "delete_everything" },
    });

    expect(reply).toEqual({
      body: {
        error: { code: -32_602, message: "Unknown tool: delete_everything" },
        id: 3,
        jsonrpc: "2.0",
      },
      kind: "reply",
    });
  });

  test("answers a notification without a reply", async () => {
    const session = freshSession();
    setAcpToolAccess(session.key, [echoTool], context);

    const reply = await handleAcpMcpRequest(session.token, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    expect(reply).toEqual({ kind: "accepted" });
  });

  test("the stdio bridge relays a JSON-RPC line to the endpoint and back", async () => {
    const session = freshSession();
    setAcpToolAccess(session.key, [echoTool], context);

    const server = Bun.serve({
      fetch: async (request) => {
        const token = new URL(request.url).pathname.split("/").pop() ?? "";
        const parsed = acpMcpRequestSchema.safeParse(await request.json());

        if (!parsed.success) {
          return new Response(null, { status: 400 });
        }

        const reply = await handleAcpMcpRequest(token, parsed.data);

        if (reply.kind === "unknown") {
          return new Response("{}", { status: 404 });
        }

        if (reply.kind === "accepted") {
          return new Response(null, { status: 202 });
        }

        return Response.json(reply.body);
      },
      port: 0,
    });

    servers.push(server);

    const endpoint = new URL(session.url.toString());
    endpoint.host = `127.0.0.1:${server.port}`;

    const bridge = Bun.spawn([process.execPath, "-e", ACP_MCP_BRIDGE_SOURCE], {
      env: { ...process.env, NAKAMA_ACP_MCP_URL: endpoint.toString() },
      stdin: "pipe",
      stdout: "pipe",
    });

    bridge.stdin.write(
      `${JSON.stringify({ id: 7, jsonrpc: "2.0", method: "tools/list" })}\n`
    );
    bridge.stdin.flush();

    const line = await readFirstLine(bridge.stdout);
    bridge.kill();

    expect(JSON.parse(line)).toEqual({
      id: 7,
      jsonrpc: "2.0",
      result: {
        tools: [
          {
            description: "Echo the text back",
            inputSchema: echoParameters,
            name: "echo_tool",
          },
        ],
      },
    });
  });
});

async function readFirstLine(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (!buffered.includes("\n")) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffered += decoder.decode(value, { stream: true });
  }

  reader.releaseLock();

  return buffered.split("\n")[0] ?? "";
}
