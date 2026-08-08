import { describe, expect, test } from "bun:test";
import {
  BUILTIN_TOOL_IDS,
  GENERATE_IMAGE_TOOL_ID,
} from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { ensureGenerateImageToolDefinition } from "./org-profiles";
import {
  ensureBuiltinToolDefinitions,
  ensurePreinstalledMcpServers,
  removeDeprecatedBuiltinTools,
  removeDeprecatedServerTools,
  removeUnsupportedTools,
  seedDatabase,
} from "./seed";

describe("seed cleanup", () => {
  test("removes unsupported tool handler types", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      createdAt: now,
      id: "profile_test",
      isSuper: false,
      model: null,
      name: "Test",
      systemPrompt: "test",
      updatedAt: now,
    });

    await db.upsertTool({
      createdAt: now,
      description: "Old unsupported tool",
      handlerConfig: {},
      handlerType: "custom",
      id: "tool_custom",
      name: "legacy-custom",
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
      createdAt: now,
      id: "profile_test",
      isSuper: false,
      model: null,
      name: "Test",
      systemPrompt: "test",
      updatedAt: now,
    });

    await db.upsertTool({
      createdAt: now,
      description: "Deprecated archive tool",
      handlerConfig: { name: "archive_profile_memory" },
      handlerType: "builtin",
      id: "tool_archive_profile_memory",
      name: "archive_profile_memory",
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
      createdAt: now,
      id: "profile_test",
      isSuper: false,
      model: null,
      name: "Test",
      systemPrompt: "test",
      updatedAt: now,
    });

    await db.upsertTool({
      createdAt: now,
      description: "Deprecated memory tool",
      handlerConfig: { name: "update_profile_memory" },
      handlerType: "builtin",
      id: "tool_update_profile_memory",
      name: "update_profile_memory",
      updatedAt: now,
    });

    await db.assignToolToProfile("profile_test", "tool_update_profile_memory");

    await removeDeprecatedBuiltinTools(db);

    expect(await db.getTool("tool_update_profile_memory")).toBeNull();
    expect(await db.listToolsForProfile("profile_test")).toHaveLength(0);
  });

  test("removes deprecated create_skill tool", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      createdAt: now,
      id: "profile_test",
      isSuper: false,
      model: null,
      name: "Test",
      systemPrompt: "test",
      updatedAt: now,
    });

    await db.upsertTool({
      createdAt: now,
      description: "Deprecated skill creation tool",
      handlerConfig: { name: "create_skill" },
      handlerType: "builtin",
      id: "tool_create_skill",
      name: "create_skill",
      updatedAt: now,
    });

    await db.assignToolToProfile("profile_test", "tool_create_skill");

    await removeDeprecatedBuiltinTools(db);

    expect(await db.getTool("tool_create_skill")).toBeNull();
    expect(await db.listToolsForProfile("profile_test")).toHaveLength(0);
  });

  test("removes deprecated save_artifact tool", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      createdAt: now,
      id: "profile_test",
      isSuper: false,
      model: null,
      name: "Test",
      systemPrompt: "test",
      updatedAt: now,
    });

    await db.upsertTool({
      createdAt: now,
      description: "Deprecated artifact tool",
      handlerConfig: { name: "save_artifact" },
      handlerType: "builtin",
      id: "tool_save_artifact",
      name: "save_artifact",
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
      createdAt: now,
      id: "profile_custom",
      isSuper: false,
      model: null,
      name: "Custom Bot",
      systemPrompt: "custom",
      updatedAt: now,
    });

    await seedDatabase(db);

    const profiles = await db.listProfiles();

    expect(profiles.map((profile) => profile.id)).toEqual(["profile_custom"]);
    expect(await db.getTool(BUILTIN_TOOL_IDS.web_search)).not.toBeNull();
    expect(await db.getTool(GENERATE_IMAGE_TOOL_ID)).not.toBeNull();
  });

  test("retains generate_image through unsupported-handler cleanup", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensureGenerateImageToolDefinition(db);
    await removeUnsupportedTools(db);

    const tool = await db.getTool(GENERATE_IMAGE_TOOL_ID);
    expect(tool).not.toBeNull();
    expect(tool?.handlerType).toBe("generate_image");
  });

  test("ensureBuiltinToolDefinitions upserts built-in tools idempotently", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensureBuiltinToolDefinitions(db);
    await ensureBuiltinToolDefinitions(db);

    expect(await db.getTool(BUILTIN_TOOL_IDS.edit_file)).not.toBeNull();
    expect(await db.getTool("tool_archive_profile_memory")).toBeNull();
    expect(await db.getTool("tool_update_profile_memory")).toBeNull();
    expect(await db.getTool("tool_save_artifact")).toBeNull();
    expect(await db.getTool("tool_create_skill")).toBeNull();
  });

  test("removeDeprecatedServerTools deletes delegate coding task", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertTool({
      createdAt: now,
      description: "Delegate coding",
      handlerConfig: {},
      handlerType: "bash",
      id: "tool_delegate_coding_task",
      name: "delegate_coding_task",
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: "profile_test",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Test",
      orgId: "org_test",
      systemPrompt: "",
      updatedAt: now,
    });
    await db.assignToolToProfile("profile_test", "tool_delegate_coding_task");

    await removeDeprecatedServerTools(db);

    expect(await db.getTool("tool_delegate_coding_task")).toBeNull();
    expect(
      (await db.listToolsForProfile("profile_test")).map((tool) => tool.id)
    ).not.toContain("tool_delegate_coding_task");
  });
});

describe("seed preinstalled MCP servers", () => {
  test("ensurePreinstalledMcpServers upserts idempotently", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensurePreinstalledMcpServers(db);
    await ensurePreinstalledMcpServers(db);

    expect((await db.listMcpServers()).length).toBe(2);
  });
});
