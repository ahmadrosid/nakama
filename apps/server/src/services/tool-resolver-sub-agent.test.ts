import { describe, expect, test } from "bun:test";
import { SUB_AGENT_TOOL_ID } from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  registerSubAgentTool,
  resolveToolsFromStorage,
} from "./tool-resolver";
import { createSubAgentTool } from "../tools/sub-agent-tool";

describe("resolveToolsFromStorage sub_agent", () => {
  test("resolves registered sub_agent tool from storage", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    registerSubAgentTool(
      createSubAgentTool({
        runSubAgentPrompt: async () => ({
          status: "success",
          summary: "ok",
          output: "ok",
        }),
      } as never),
    );

    await db.upsertTool({
      id: SUB_AGENT_TOOL_ID,
      name: "sub_agent",
      description: "Sub-agent",
      handlerType: "sub_agent",
      handlerConfig: {},
      createdAt: now,
      updatedAt: now,
    });

    const tools = await resolveToolsFromStorage(await db.listTools(), db);

    expect(tools.map((tool) => tool.name)).toContain("sub_agent");
  });
});
