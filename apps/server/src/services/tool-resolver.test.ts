import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@nakama/core";
import { emailTool } from "@nakama/core/tools/email";
import {
  LIST_PROFILE_SESSIONS_TOOL_ID,
  READ_PROFILE_SESSION_TOOL_ID,
  SUB_AGENT_TOOL_ID,
} from "@nakama/core/tools/protected";
import { saveWebSearchConfig } from "@nakama/core/web-search-config";
import {
  createInMemoryDatabaseAdapter,
  type StoredToolRecord,
} from "@nakama/db";
import { createSessionTools } from "../tools/session-tools";
import { createSubAgentTool } from "../tools/sub-agent-tool";
import { AgentService } from "./agent-service";
import {
  omitUnavailableBuiltinTools,
  resolveProfileStoredTools,
  resolveToolsFromStorage,
} from "./tool-resolver";

const webSearchTool: ToolDefinition = {
  description: "Search the web",
  name: "web_search",
  parameters: { additionalProperties: false, properties: {}, type: "object" },
  async run() {
    return { ok: true };
  },
};

async function upsertTool(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
  row: Pick<StoredToolRecord, "handlerType" | "id" | "name">
) {
  const now = new Date().toISOString();
  await db.upsertTool({
    createdAt: now,
    description: row.name,
    handlerConfig: {},
    handlerType: row.handlerType,
    id: row.id,
    name: row.name,
    updatedAt: now,
  });
}

describe("omitUnavailableBuiltinTools", () => {
  test("drops email when mailbox is not configured", () => {
    const tools = [webSearchTool, emailTool];

    expect(
      omitUnavailableBuiltinTools(tools, false).map((tool) => tool.name)
    ).toEqual(["web_search"]);
    expect(
      omitUnavailableBuiltinTools(tools, true).map((tool) => tool.name)
    ).toEqual(["web_search", "email"]);
  });
});

describe("resolveToolsFromStorage sub_agent", () => {
  test("resolves registered sub_agent tool from storage", async () => {
    const db = createInMemoryDatabaseAdapter();
    const subAgent = createSubAgentTool({
      runSubAgentPrompt: async () => ({
        output: "ok",
        status: "success",
        summary: "ok",
      }),
    } as never);
    await upsertTool(db, {
      handlerType: "sub_agent",
      id: SUB_AGENT_TOOL_ID,
      name: "sub_agent",
    });

    const tools = await resolveToolsFromStorage(await db.listTools(), db, [], {
      serverTools: { subAgent },
    });

    expect(tools.map((tool) => tool.name)).toContain("sub_agent");
  });
});

describe("resolveToolsFromStorage session", () => {
  function sessionTools() {
    return createSessionTools(
      new AgentService(null, null, createInMemoryDatabaseAdapter())
    );
  }

  async function seedSessionToolRows(
    db: ReturnType<typeof createInMemoryDatabaseAdapter>
  ) {
    await upsertTool(db, {
      handlerType: "session",
      id: LIST_PROFILE_SESSIONS_TOOL_ID,
      name: "list_profile_sessions",
    });
    await upsertTool(db, {
      handlerType: "session",
      id: READ_PROFILE_SESSION_TOOL_ID,
      name: "read_profile_session",
    });
  }

  test("resolves both registered session tools from storage", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedSessionToolRows(db);
    const names = (
      await resolveToolsFromStorage(await db.listTools(), db, [], {
        serverTools: { session: sessionTools() },
      })
    ).map((tool) => tool.name);

    expect(names).toContain("list_profile_sessions");
    expect(names).toContain("read_profile_session");
  });

  test("resolves nothing when the tools were never registered", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedSessionToolRows(db);
    const names = (
      await resolveToolsFromStorage(await db.listTools(), db, [], {
        serverTools: { session: [] },
      })
    ).map((tool) => tool.name);

    expect(names).not.toContain("list_profile_sessions");
    expect(names).not.toContain("read_profile_session");
  });
});

describe("resolveProfileStoredTools web_search", () => {
  const WEB_SEARCH_TOOL_ID = "tool_web_search";
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  async function useTempConfigDir(): Promise<void> {
    configDir = await mkdtemp(join(tmpdir(), "nakama-web-search-resolver-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  }

  test("keeps the provider-hosted stub when no back-end is configured", async () => {
    await useTempConfigDir();
    const db = createInMemoryDatabaseAdapter();
    await upsertTool(db, {
      handlerType: "builtin",
      id: WEB_SEARCH_TOOL_ID,
      name: "web_search",
    });

    const tools = await resolveProfileStoredTools(await db.listTools(), db);
    const webSearch = tools.find((tool) => tool.name === "web_search");

    expect(webSearch?.hosted).toBe(true);
    await expect(webSearch?.run({ query: "news" }, {})).rejects.toThrow(
      "provider"
    );
  });

  test("swaps in a locally executed tool once a back-end is configured", async () => {
    await useTempConfigDir();
    await saveWebSearchConfig({ apiKey: "exa-key", provider: "exa" });
    const db = createInMemoryDatabaseAdapter();
    await upsertTool(db, {
      handlerType: "builtin",
      id: WEB_SEARCH_TOOL_ID,
      name: "web_search",
    });

    const tools = await resolveProfileStoredTools(await db.listTools(), db);
    const webSearch = tools.filter((tool) => tool.name === "web_search");

    expect(webSearch).toHaveLength(1);
    expect(webSearch[0]?.hosted).toBe(false);
    expect(webSearch[0]?.description).toContain("Exa");
  });
});
