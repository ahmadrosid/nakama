import { describe, expect, test } from "bun:test";
import type { StoredMcpServerRecord } from "@nakama/db";
import type { McpService } from "./mcp-service";
import {
  buildMcpToolDefinitions,
  isValidLlmToolName,
  namespacedMcpToolName,
  sanitizeLlmToolNamePart,
} from "./mcp-tool-bridge";

function failingMcpService(message: string): Pick<McpService, "callTool"> {
  return {
    callTool() {
      return Promise.reject(new Error(message));
    },
  };
}

function serverLookup(servers: StoredMcpServerRecord[]) {
  return {
    async getMcpServer(serverId: string) {
      return servers.find((server) => server.id === serverId) ?? null;
    },
  };
}
describe("mcp tool bridge", () => {
  test("namespaces tool names by server", () => {
    expect(namespacedMcpToolName("filesystem", "read_file")).toBe(
      "filesystem__read_file"
    );
  });

  test("sanitizes invalid characters in MCP tool names", () => {
    expect(sanitizeLlmToolNamePart("list/tools")).toBe("list_tools");
    expect(sanitizeLlmToolNamePart("my server")).toBe("my_server");
    expect(namespacedMcpToolName("user.tolaria", "tools.list")).toBe(
      "user_tolaria__tools_list"
    );
    expect(
      isValidLlmToolName(namespacedMcpToolName("user.tolaria", "tools.list"))
    ).toBe(true);
  });

  test("deduplicates sanitized tool names", () => {
    const mcpService = failingMcpService("unused");
    const servers: StoredMcpServerRecord[] = [
      {
        cachedTools: [
          { description: "List tools", name: "tools.list" },
          { description: "List tools again", name: "tools_list" },
        ],
        config: { url: "https://example.com/mcp" },
        createdAt: "2026-01-01T00:00:00.000Z",
        enabled: true,
        id: "mcp_1",
        lastError: null,
        name: "github",
        status: "disconnected",
        transport: "http",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const tools = buildMcpToolDefinitions(
      servers,
      mcpService,
      serverLookup(servers),
      "org_test",
      "profile_test"
    );

    expect(tools.map((tool) => tool.name)).toEqual([
      "github__tools_list",
      "github__tools_list_2",
    ]);
    expect(tools.every((tool) => isValidLlmToolName(tool.name))).toBe(true);
  });

  test("builds tools only from attached servers", () => {
    const mcpService = failingMcpService("unused");
    const servers: StoredMcpServerRecord[] = [
      {
        cachedTools: [
          {
            description: "Read a file",
            inputSchema: {
              properties: { path: { type: "string" } },
              type: "object",
            },
            name: "read_file",
          },
        ],
        config: { url: "https://example.com/mcp" },
        createdAt: "2026-01-01T00:00:00.000Z",
        enabled: true,
        id: "mcp_1",
        lastError: null,
        name: "filesystem",
        status: "disconnected",
        transport: "http",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const tools = buildMcpToolDefinitions(
      servers,
      mcpService,
      serverLookup(servers),
      "org_test",
      "profile_test"
    );

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("filesystem__read_file");
  });

  test("returns an error when the call fails", async () => {
    const mcpService = failingMcpService(
      'MCP server "filesystem" is not connected.'
    );
    const servers: StoredMcpServerRecord[] = [
      {
        cachedTools: [{ description: "Read a file", name: "read_file" }],
        config: { url: "https://example.com/mcp" },
        createdAt: "2026-01-01T00:00:00.000Z",
        enabled: true,
        id: "mcp_1",
        lastError: null,
        name: "filesystem",
        status: "disconnected",
        transport: "http",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const tools = buildMcpToolDefinitions(
      servers,
      mcpService,
      serverLookup(servers),
      "org_test",
      "profile_test"
    );
    const result = await tools[0]!.run({}, {});

    expect(result).toEqual({
      error: 'MCP server "filesystem" is not connected.',
    });
  });

  test("excludes disabled servers from new tool definitions", () => {
    const mcpService = failingMcpService("unused");
    const servers: StoredMcpServerRecord[] = [
      {
        cachedTools: [{ description: "Read a file", name: "read_file" }],
        config: { url: "https://example.com/mcp" },
        createdAt: "2026-01-01T00:00:00.000Z",
        enabled: false,
        id: "mcp_1",
        lastError: null,
        name: "filesystem",
        status: "disconnected",
        transport: "http",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const tools = buildMcpToolDefinitions(
      servers,
      mcpService,
      serverLookup(servers),
      "org_test",
      "profile_test"
    );

    expect(tools).toEqual([]);
  });

  test("blocks an existing tool definition after its server is disabled", async () => {
    let enabled = true;
    const calls: string[] = [];
    const mcpService: Pick<McpService, "callTool"> = {
      callTool() {
        calls.push("callTool");
        return Promise.resolve({ ok: true });
      },
    };
    const server: StoredMcpServerRecord = {
      cachedTools: [{ description: "Read a file", name: "read_file" }],
      config: { command: "mcp-filesystem" },
      createdAt: "2026-01-01T00:00:00.000Z",
      enabled: true,
      id: "mcp_1",
      lastError: null,
      name: "filesystem",
      status: "connected",
      transport: "stdio",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const tools = buildMcpToolDefinitions(
      [server],
      mcpService,
      {
        async getMcpServer() {
          return { ...server, enabled };
        },
      },
      "org_test",
      "profile_test"
    );

    enabled = false;
    const result = await tools[0]!.run({}, {});

    expect(result).toEqual({ error: expect.any(String) });
    expect(calls).toEqual([]);
  });

  test("adds validated current chat images only for opted-in MCP tools", async () => {
    const calls: unknown[] = [];
    const server: StoredMcpServerRecord = {
      cachedTools: [
        {
          description: "Inspect",
          inputSchema: {
            properties: {
              nakamaContext: {
                properties: {},
                type: "object",
                "x-nakama-context": "current-chat",
              },
              query: { type: "string" },
            },
            type: "object",
          },
          name: "inspect",
        },
      ],
      config: { url: "https://example.com/mcp" },
      createdAt: "2026-01-01T00:00:00.000Z",
      enabled: true,
      id: "mcp_1",
      lastError: null,
      name: "images",
      status: "connected",
      transport: "http",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const tool = buildMcpToolDefinitions(
      [server],
      {
        async callTool(_server, _name, args) {
          calls.push(args);
          return { ok: true };
        },
      },
      serverLookup([server]),
      "org_test",
      "profile_test"
    )[0]!;

    expect(tool.parameters.properties).not.toHaveProperty("nakamaContext");
    await tool.run(
      { nakamaContext: { images: [] }, query: "read it" },
      {
        currentChatImages: [{ attachmentId: "att_1", mediaType: "image/png" }],
        loadAttachment: async () => ({
          bytes: Buffer.from("image"),
          mediaType: "image/png",
        }),
        whatsappMessage: {
          chatJid: "chat@g.us",
          fromMe: false,
          isGroup: true,
          senderJid: "sender@s.whatsapp.net",
          senderJids: ["sender@s.whatsapp.net"],
        },
      }
    );

    expect(calls).toEqual([
      {
        nakamaContext: {
          images: [
            {
              data: Buffer.from("image").toString("base64"),
              mediaType: "image/png",
            },
          ],
          whatsapp: {
            chatJid: "chat@g.us",
            fromMe: false,
            isGroup: true,
            senderJid: "sender@s.whatsapp.net",
            senderJids: ["sender@s.whatsapp.net"],
          },
        },
        query: "read it",
      },
    ]);
  });

  test("returns an error and skips MCP call for an invalid current image", async () => {
    let called = false;
    const server: StoredMcpServerRecord = {
      cachedTools: [
        {
          description: "Inspect",
          inputSchema: {
            properties: {
              nakamaContext: {
                type: "object",
                "x-nakama-context": "current-chat",
              },
            },
            type: "object",
          },
          name: "inspect",
        },
      ],
      config: { url: "https://example.com/mcp" },
      createdAt: "2026-01-01T00:00:00.000Z",
      enabled: true,
      id: "mcp_1",
      lastError: null,
      name: "images",
      status: "connected",
      transport: "http",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const tool = buildMcpToolDefinitions(
      [server],
      {
        async callTool() {
          called = true;
          return {};
        },
      },
      serverLookup([server]),
      "org_test",
      "profile_test"
    )[0]!;

    const result = await tool.run(
      {},
      {
        currentChatImages: [{ attachmentId: "att_1", mediaType: "image/png" }],
        loadAttachment: async () => ({
          bytes: Buffer.from("bad"),
          mediaType: "text/plain",
        }),
      }
    );

    expect(result).toEqual({ error: expect.any(String) });
    expect(called).toBe(false);
  });
});
