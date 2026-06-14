import { describe, expect, test } from "bun:test";
import { BUILTIN_TOOL_IDS } from "@tinyclaw/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { ensureBuiltinTools, removeUnsupportedTools } from "./seed";

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
  test("backfills create_skill to all existing profiles", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      id: "profile_default",
      name: "Default Bot",
      systemPrompt: "default",
      model: null,
      isSuper: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertProfile({
      id: "profile_super_bot",
      name: "Super Bot",
      systemPrompt: "super",
      model: null,
      isSuper: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertProfile({
      id: "profile_custom",
      name: "Custom Bot",
      systemPrompt: "custom",
      model: null,
      isSuper: false,
      createdAt: now,
      updatedAt: now,
    });

    await ensureBuiltinTools(db);

    expect(await db.getTool(BUILTIN_TOOL_IDS.create_skill)).not.toBeNull();

    const defaultTools = await db.listToolsForProfile("profile_default");
    const superTools = await db.listToolsForProfile("profile_super_bot");
    const customTools = await db.listToolsForProfile("profile_custom");

    expect(defaultTools.map((tool) => tool.name)).toContain("create_skill");
    expect(superTools.map((tool) => tool.name)).toContain("create_skill");
    expect(customTools.map((tool) => tool.name)).toContain("create_skill");
    expect(customTools.map((tool) => tool.name)).not.toContain("write_file");
  });
});
