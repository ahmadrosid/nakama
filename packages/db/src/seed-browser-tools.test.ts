import { describe, expect, test } from "bun:test";
import { BROWSER_TOOL_IDS } from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./index";
import { ensureBrowserToolDefinitions } from "./org-profiles";

describe("browser tool definitions", () => {
  test("upserts every browser tool with the browser handler type", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensureBrowserToolDefinitions(db);
    await ensureBrowserToolDefinitions(db);

    for (const [name, id] of Object.entries(BROWSER_TOOL_IDS)) {
      const tool = await db.getTool(id);

      expect(tool?.name).toBe(name);
      expect(tool?.handlerType).toBe("browser");
    }
  });
});
