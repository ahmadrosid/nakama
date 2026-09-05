import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveWebSearchConfig } from "@nakama/core/web-search-config";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { resolveProfileStoredTools } from "./tool-resolver";

const WEB_SEARCH_TOOL_ID = "tool_web_search";

async function seedWebSearchTool(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>
) {
  const now = new Date().toISOString();
  await db.upsertTool({
    createdAt: now,
    description: "Search the web",
    handlerConfig: {},
    handlerType: "builtin",
    id: WEB_SEARCH_TOOL_ID,
    name: "web_search",
    updatedAt: now,
  });
}

describe("resolveProfileStoredTools web_search", () => {
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
    await seedWebSearchTool(db);

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
    await seedWebSearchTool(db);

    const tools = await resolveProfileStoredTools(await db.listTools(), db);
    const webSearch = tools.filter((tool) => tool.name === "web_search");

    expect(webSearch).toHaveLength(1);
    expect(webSearch[0]?.hosted).toBe(false);
    expect(webSearch[0]?.description).toContain("Exa");
  });
});
