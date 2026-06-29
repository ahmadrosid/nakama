import { describe, expect, test } from "bun:test";
import { BUILTIN_TOOL_IDS } from "@tinyclaw/core/tools/protected";
import { PREINSTALLED_MCP_SERVER_IDS } from "@tinyclaw/core/mcp/preinstalled";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { ensureBuiltinToolDefinitions, ensurePreinstalledMcpServers, removeUnsupportedTools, seedDatabase } from "./seed";

describe("seed cleanup", () => {
  test("removes unsupported tool handler types", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      id: "profile_test",
      name: "Test",
      systemPrompt: "test",
      model: null,
      isSuper: false,
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertTool({
      id: "tool_custom",
      name: "legacy-custom",
      description: "Old unsupported tool",
      handlerType: "custom",
      handlerConfig: {},
      createdAt: now,
      updatedAt: now,
    });

    await db.assignToolToProfile("profile_test", "tool_custom");

    await removeUnsupportedTools(db);

    expect(await db.getTool("tool_custom")).toBeNull();
    expect(await db.listToolsForProfile("profile_test")).toHaveLength(0);
  });
});

describe("seed built-in tools", () => {
  test("registers built-in tool definitions without creating global profiles", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      id: "profile_custom",
      name: "Custom Bot",
      systemPrompt: "custom",
      model: null,
      isSuper: false,
      createdAt: now,
      updatedAt: now,
    });

    await seedDatabase(db);

    const profiles = await db.listProfiles();

    expect(profiles.map((profile) => profile.id)).toEqual(["profile_custom"]);
    expect(await db.getTool(BUILTIN_TOOL_IDS.web_search)).not.toBeNull();
  });

  test("ensureBuiltinToolDefinitions upserts built-in tools idempotently", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensureBuiltinToolDefinitions(db);
    await ensureBuiltinToolDefinitions(db);

    expect(await db.getTool(BUILTIN_TOOL_IDS.create_skill)).not.toBeNull();
    expect(await db.getTool(BUILTIN_TOOL_IDS.archive_profile_memory)).not.toBeNull();
  });
});

describe("seed preinstalled MCP servers", () => {
  test("ensurePreinstalledMcpServers registers exa and currency-conversion", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensurePreinstalledMcpServers(db);

    const exa = await db.getMcpServer(PREINSTALLED_MCP_SERVER_IDS.exa);
    const currency = await db.getMcpServer(PREINSTALLED_MCP_SERVER_IDS.currency_conversion);

    expect(exa?.name).toBe("exa");
    expect(exa?.transport).toBe("http");
    expect(currency?.name).toBe("currency-conversion");
    expect(currency?.transport).toBe("http");
  });

  test("ensurePreinstalledMcpServers upserts idempotently", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensurePreinstalledMcpServers(db);
    await ensurePreinstalledMcpServers(db);

    expect((await db.listMcpServers()).length).toBe(2);
  });
});
