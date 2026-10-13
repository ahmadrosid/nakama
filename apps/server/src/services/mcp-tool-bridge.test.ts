import { describe, expect, test } from "bun:test";
import { createAgentChatSession } from "@nakama/agent";
import type {
  GenerateChatInput,
  LlmToolDefinition,
  ProviderClient,
  ToolCall,
} from "@nakama/core";
import type { StoredMcpServerRecord } from "@nakama/db";
import { createTurnTools } from "../../../../packages/agent/src/tool-loop";
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

function discoveryServer(): StoredMcpServerRecord {
  const targets = [
    { description: "Read a file from disk", name: "read_document" },
    { description: "Retrieve a billing receipt", name: "download_invoice" },
    { description: "Schedule a meeting", name: "create_event" },
  ];

  return {
    cachedTools: Array.from({ length: 100 }, (_, index) => ({
      ...(targets[index] ?? {
        description: `Operation ${index}`,
        name: `operation_${index}`,
      }),
      inputSchema: {
        properties: Object.fromEntries(
          Array.from({ length: 8 }, (_, field) => [
            `field_${field}`,
            { description: "Optional input for the operation", type: "string" },
          ])
        ),
        type: "object",
      },
    })),
    config: { url: "https://example.invalid/mcp" },
    createdAt: "2026-01-01T00:00:00.000Z",
    enabled: true,
    id: "mcp_discovery",
    lastError: null,
    name: "office",
    status: "connected",
    transport: "http",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("mcp tool bridge", () => {
  test.each([
    ["read file", "read_document"],
    ["billing receipt", "download_invoice"],
    ["schedule meeting", "create_event"],
  ])(
    "compares eager and lazy definitions for the same task: %s",
    async (query, target) => {
      const server = discoveryServer();

      const metrics: Array<{
        calls: number;
        initialTokens: number;
        result: string;
      }> = [];

      for (const lazy of [false, true]) {
        const calls: string[] = [];
        const snapshots: Array<LlmToolDefinition[] | undefined> = [];

        const tools = buildMcpToolDefinitions(
          [server],
          {
            async callTool(_server, name) {
              calls.push(name);

              return { ok: true };
            },
          },
          serverLookup([server]),
          "org_test",
          "profile_test",
          lazy ? async () => true : undefined
        );

        const provider: ProviderClient = {
          async generateChat(input: GenerateChatInput) {
            snapshots.push(input.tools);

            const done = input.messages.some(
              (message) =>
                message.role === "tool" && message.name === `office__${target}`
            );

            const available = input.tools?.some(
              (tool) => tool.name === `office__${target}`
            );

            const toolCalls: ToolCall[] = done
              ? []
              : [
                  {
                    arguments: available ? {} : { query },
                    id: `call_${snapshots.length}`,
                    name: available ? `office__${target}` : "find_tools",
                  },
                ];

            const content = done ? "Done" : "";

            return {
              assistantMessage: { content, role: "assistant", toolCalls },
              content,
              toolCalls,
            };
          },
          generateText: async () => ({ content: "unused" }),
          name: "openai",
          async streamChat(input, handlers) {
            const result = await this.generateChat(input);
            handlers.onChunk(result.content);

            return result;
          },
        };

        const session = createAgentChatSession(
          { provider, tools },
          {
            compaction: { contextWindow: 200_000, maxOutputTokens: 1000 },
          }
        );

        const initialTokens =
          session.getContextUsage()!.breakdown!.toolDefinitions;

        const result = await session.send(query);

        expect(calls).toEqual([target]);
        expect(snapshots[0]).toHaveLength(lazy ? 1 : 100);

        if (lazy) {
          expect(snapshots[1]?.map((tool) => tool.name)).toEqual([
            "find_tools",
            `office__${target}`,
          ]);
          expect(
            session
              .getHistory()
              .find(
                (message) =>
                  message.role === "tool" && message.name === "find_tools"
              )?.role
          ).toBe("tool");
        }

        metrics.push({ calls: snapshots.length, initialTokens, result });
      }

      expect(metrics[1]!.result).toBe(metrics[0]!.result);
      expect(metrics[1]!.initialTokens).toBeLessThan(
        metrics[0]!.initialTokens / 10
      );
      console.info("MCP discovery comparison", {
        eager: metrics[0],
        lazy: metrics[1],
        query,
      });
    }
  );

  test("rechecks discovery and execution after access or the server changes", async () => {
    const server = discoveryServer();
    let allowed = true;
    let calls = 0;

    const tools = buildMcpToolDefinitions(
      [server],
      {
        async callTool() {
          calls += 1;

          return { ok: true };
        },
      },
      serverLookup([server]),
      "org_test",
      "profile_test",
      async (_serverId, _tool, context) =>
        allowed &&
        context.orgId === "org_test" &&
        context.profileId === "profile_test"
    );

    const context = { orgId: "org_test", profileId: "profile_test" };
    const active = createTurnTools(tools);
    const search = active[0]!;

    expect(
      await search.run(
        { query: "billing receipt" },
        { ...context, orgId: "org_other" }
      )
    ).toEqual({ remaining: 0, tools: [] });
    expect(
      await search.run({ query: "billing receipt" }, context)
    ).toHaveProperty("tools.0.name", "office__download_invoice");

    const discovered = active.find(
      (tool) => tool.name === "office__download_invoice"
    )!;

    allowed = false;
    expect(await discovered.run({}, context)).toHaveProperty("error");
    expect(await search.run({ query: "billing receipt" }, context)).toEqual({
      remaining: 0,
      tools: [],
    });
    allowed = true;
    server.enabled = false;
    expect(await discovered.run({}, context)).toHaveProperty("error");
    expect(await search.run({ query: "billing receipt" }, context)).toEqual({
      remaining: 0,
      tools: [],
    });
    server.enabled = true;
    server.cachedTools = [];
    expect(await discovered.run({}, context)).toHaveProperty("error");
    expect(calls).toBe(0);
  });

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

    expect(tool.parameters?.properties).toBeDefined();
    expect(tool.parameters?.properties).not.toHaveProperty("nakamaContext");
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
