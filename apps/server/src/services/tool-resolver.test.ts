import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@nakama/core";
import { emailTool } from "@nakama/core/tools/email";
import {
  BROWSER_TOOL_IDS,
  LIST_PROFILE_SESSIONS_TOOL_ID,
  READ_PROFILE_SESSION_TOOL_ID,
  SUB_AGENT_TOOL_ID,
} from "@nakama/core/tools/protected";
import { saveWebSearchConfig } from "@nakama/core/web-search-config";
import {
  createInMemoryDatabaseAdapter,
  type StoredToolRecord,
} from "@nakama/db";
import { createBrowserTools } from "../tools/browser-tools";
import { createSessionTools } from "../tools/session-tools";
import { createSubAgentTool } from "../tools/sub-agent-tool";
import { AgentService } from "./agent-service";
import {
  omitUnavailableBuiltinTools,
  omitUnavailableToolDetails,
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
      omitUnavailableBuiltinTools(tools, {
        cloudBrowser: true,
        email: false,
      }).map((tool) => tool.name)
    ).toEqual(["web_search"]);
    expect(
      omitUnavailableBuiltinTools(tools, {
        cloudBrowser: true,
        email: true,
      }).map((tool) => tool.name)
    ).toEqual(["web_search", "email"]);
  });

  test("drops the browser tools when Kernel is not set up", () => {
    const tools = [webSearchTool, ...createBrowserTools()];

    expect(
      omitUnavailableBuiltinTools(tools, {
        cloudBrowser: false,
        email: true,
      }).map((tool) => tool.name)
    ).toEqual(["web_search"]);
    expect(
      omitUnavailableBuiltinTools(tools, { cloudBrowser: true, email: true })
    ).toHaveLength(tools.length);
  });
});

describe("resolveToolsFromStorage sub_agent", () => {
  test("resolves registered sub_agent tool from storage", async () => {
    const db = createInMemoryDatabaseAdapter();

    // SAFETY: The test fixture matches the contract used by this test.
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

describe("omitUnavailableToolDetails", () => {
  const original = {
    configDir: process.env.NAKAMA_CONFIG_DIR,
    key: process.env.KERNEL_API_KEY,
    provider: process.env.NAKAMA_BROWSER_PROVIDER,
  };

  let configDir = "";

  afterEach(async () => {
    await rm(configDir, { force: true, recursive: true });

    for (const [name, value] of [
      ["NAKAMA_CONFIG_DIR", original.configDir],
      ["KERNEL_API_KEY", original.key],
      ["NAKAMA_BROWSER_PROVIDER", original.provider],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  const detail = (name: string, handlerType: string) => ({
    createdAt: "",
    description: "",
    handlerConfig: {},
    handlerType,
    id: `tool_${name}`,
    name,
    updatedAt: "",
  });

  test("lists the browser tools only when Kernel is set up", async () => {
    const response = {
      tools: [detail("bash", "bash"), detail("browser_read", "browser")],
    };

    configDir = await mkdtemp(join(tmpdir(), "nakama-tool-details-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    delete process.env.NAKAMA_BROWSER_PROVIDER;
    delete process.env.KERNEL_API_KEY;

    const hidden = await omitUnavailableToolDetails(response);

    process.env.NAKAMA_BROWSER_PROVIDER = "kernel";
    process.env.KERNEL_API_KEY = "kernel-key";

    const shown = await omitUnavailableToolDetails(response);

    expect(hidden.tools.map((tool) => tool.name)).toEqual(["bash"]);
    expect(shown.tools.map((tool) => tool.name)).toEqual([
      "bash",
      "browser_read",
    ]);
  });
});

describe("resolveToolsFromStorage browser", () => {
  test("resolves every seeded browser tool with no server overrides", async () => {
    const db = createInMemoryDatabaseAdapter();

    for (const [name, id] of Object.entries(BROWSER_TOOL_IDS)) {
      await upsertTool(db, { handlerType: "browser", id, name });
    }

    const names = (
      await resolveToolsFromStorage(await db.listTools(), db, [], {})
    ).map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining(Object.keys(BROWSER_TOOL_IDS))
    );
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
    delete process.env.EXA_API_KEY;
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
    process.env.EXA_API_KEY = "exa-key";
    await saveWebSearchConfig({ provider: "exa" });
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
