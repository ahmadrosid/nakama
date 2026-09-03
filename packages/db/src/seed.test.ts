import { describe, expect, test } from "bun:test";
import {
  BUILTIN_TOOL_IDS,
  GENERATE_IMAGE_TOOL_ID,
} from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./index";
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
  test("deleteTool unassigns every profile before deleting", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      createdAt: now,
      id: "profile_a",
      isSuper: false,
      model: null,
      name: "A",
      systemPrompt: "a",
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: "profile_b",
      isSuper: false,
      model: null,
      name: "B",
      systemPrompt: "b",
      updatedAt: now,
    });
    await db.upsertTool({
      createdAt: now,
      description: "doomed",
      handlerConfig: {},
      handlerType: "custom",
      id: "tool_doomed",
      name: "doomed-custom",
      updatedAt: now,
    });
    await db.assignToolToProfile("profile_a", "tool_doomed");
    await db.assignToolToProfile("profile_b", "tool_doomed");

    expect(await db.deleteTool("tool_doomed")).toBe(true);
    expect(await db.getTool("tool_doomed")).toBeNull();
    expect(await db.listToolsForProfile("profile_a")).toHaveLength(0);
    expect(await db.listToolsForProfile("profile_b")).toHaveLength(0);
  });

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

    expect((await db.listMcpServers()).length).toBe(3);
  });

  test("seeds firecrawl keyless HTTP MCP unassigned", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensurePreinstalledMcpServers(db);

    const firecrawl = await db.getMcpServer("mcp_firecrawl");

    expect(firecrawl).toMatchObject({
      enabled: true,
      id: "mcp_firecrawl",
      name: "firecrawl",
      transport: "http",
    });
    expect(firecrawl?.config).toEqual({
      url: "https://mcp.firecrawl.dev/v2/mcp",
    });
    expect(await db.listProfilesForMcpServer("mcp_firecrawl")).toEqual([]);
  });

  test("preserves HTTP headers and enabled on re-seed", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await ensurePreinstalledMcpServers(db);

    const firecrawl = await db.getMcpServer("mcp_firecrawl");
    const exa = await db.getMcpServer("mcp_exa");

    expect(firecrawl).not.toBeNull();
    expect(exa).not.toBeNull();

    await db.upsertMcpServer({
      ...firecrawl!,
      cachedTools: [{ description: "search", name: "firecrawl_search" }],
      config: {
        headers: { Authorization: "Bearer fc-test" },
        url: "https://mcp.firecrawl.dev/v2/mcp",
      },
      enabled: false,
      lastError: "previous error",
      status: "error",
      updatedAt: now,
    });
    await db.upsertMcpServer({
      ...exa!,
      config: {
        headers: { "x-api-key": "exa-secret" },
        url: "https://mcp.exa.ai/mcp",
      },
      updatedAt: now,
    });

    await ensurePreinstalledMcpServers(db);

    const reseededFirecrawl = await db.getMcpServer("mcp_firecrawl");
    const reseededExa = await db.getMcpServer("mcp_exa");

    expect(reseededFirecrawl?.config).toEqual({
      headers: { Authorization: "Bearer fc-test" },
      url: "https://mcp.firecrawl.dev/v2/mcp",
    });
    expect(reseededFirecrawl?.enabled).toBe(false);
    expect(reseededFirecrawl?.cachedTools).toEqual([
      { description: "search", name: "firecrawl_search" },
    ]);
    expect(reseededFirecrawl?.lastError).toBe("previous error");
    expect(reseededFirecrawl?.status).toBe("error");
    expect(reseededExa?.config).toEqual({
      headers: { "x-api-key": "exa-secret" },
      url: "https://mcp.exa.ai/mcp",
    });
  });

  test("skips insert when another server already owns the catalog name", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };

    await db.upsertMcpServer({
      cachedTools: [],
      config: {
        headers: { Authorization: "Bearer fc-custom" },
        url: "https://mcp.firecrawl.dev/v2/mcp",
      },
      createdAt: now,
      enabled: true,
      id: "mcp_custom_firecrawl",
      lastError: null,
      name: "firecrawl",
      status: "disconnected",
      transport: "http",
      updatedAt: now,
    });

    try {
      await ensurePreinstalledMcpServers(db);
    } finally {
      console.warn = originalWarn;
    }

    expect(await db.getMcpServer("mcp_firecrawl")).toBeNull();
    expect(await db.getMcpServerByName("firecrawl")).toMatchObject({
      id: "mcp_custom_firecrawl",
    });
    expect(warns.join("\n")).toContain("mcp_custom_firecrawl");
    expect(warns.join("\n")).not.toContain("fc-custom");
    expect(warns.join("\n")).not.toContain("Authorization");
  });

  test("migrates a Firecrawl key-in-URL into an Authorization header", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await ensurePreinstalledMcpServers(db);
    const firecrawl = await db.getMcpServer("mcp_firecrawl");
    expect(firecrawl).not.toBeNull();

    await db.upsertMcpServer({
      ...firecrawl!,
      config: { url: "https://mcp.firecrawl.dev/fc-legacy/v2/mcp" },
      updatedAt: now,
    });

    await ensurePreinstalledMcpServers(db);

    expect((await db.getMcpServer("mcp_firecrawl"))?.config).toEqual({
      headers: { Authorization: "Bearer fc-legacy" },
      url: "https://mcp.firecrawl.dev/v2/mcp",
    });
  });
});
