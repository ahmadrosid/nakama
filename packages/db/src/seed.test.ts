import { describe, expect, test } from "bun:test";
import { BUILTIN_TOOL_IDS, DELEGATE_CODING_TASK_TOOL_ID } from "@nakama/core/tools/protected";
import { PREINSTALLED_MCP_SERVER_IDS } from "@nakama/core/mcp/preinstalled";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import {
  ensureBuiltinToolDefinitions,
  ensurePreinstalledMcpServers,
  ensureServerToolDefinitions,
  removeDeprecatedBuiltinTools,
  removeUnsupportedTools,
  seedDatabase,
} from "./seed";

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

  test("removes deprecated builtin tools", async () => {
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
      id: "tool_archive_profile_memory",
      name: "archive_profile_memory",
      description: "Deprecated archive tool",
      handlerType: "builtin",
      handlerConfig: { name: "archive_profile_memory" },
      createdAt: now,
      updatedAt: now,
    });

    await db.assignToolToProfile("profile_test", "tool_archive_profile_memory");

    await removeDeprecatedBuiltinTools(db);

    expect(await db.getTool("tool_archive_profile_memory")).toBeNull();
    expect(await db.listToolsForProfile("profile_test")).toHaveLength(0);
  });

  test("removes deprecated update_profile_memory tool", async () => {
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
      id: "tool_update_profile_memory",
      name: "update_profile_memory",
      description: "Deprecated memory tool",
      handlerType: "builtin",
      handlerConfig: { name: "update_profile_memory" },
      createdAt: now,
      updatedAt: now,
    });

    await db.assignToolToProfile("profile_test", "tool_update_profile_memory");

    await removeDeprecatedBuiltinTools(db);

    expect(await db.getTool("tool_update_profile_memory")).toBeNull();
    expect(await db.listToolsForProfile("profile_test")).toHaveLength(0);
  });

  test("removes deprecated save_artifact tool", async () => {
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
      id: "tool_save_artifact",
      name: "save_artifact",
      description: "Deprecated artifact tool",
      handlerType: "builtin",
      handlerConfig: { name: "save_artifact" },
      createdAt: now,
      updatedAt: now,
    });

    await db.assignToolToProfile("profile_test", "tool_save_artifact");

    await removeDeprecatedBuiltinTools(db);

    expect(await db.getTool("tool_save_artifact")).toBeNull();
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

    expect(await db.getTool(BUILTIN_TOOL_IDS.edit_file)).not.toBeNull();
    expect(await db.getTool("tool_archive_profile_memory")).toBeNull();
    expect(await db.getTool("tool_update_profile_memory")).toBeNull();
    expect(await db.getTool("tool_save_artifact")).toBeNull();
  });

  test("ensureServerToolDefinitions registers delegate coding task", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensureServerToolDefinitions(db);

    expect(await db.getTool(DELEGATE_CODING_TASK_TOOL_ID)).not.toBeNull();
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
