import { describe, expect, test } from "bun:test";
import { SUB_AGENT_TOOL_ID } from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createSubAgentTool } from "../tools/sub-agent-tool";
import { resolveToolsFromStorage } from "./tool-resolver";

describe("resolveToolsFromStorage sub_agent", () => {
  test("resolves registered sub_agent tool from storage", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    const subAgent = createSubAgentTool({
      runSubAgentPrompt: async () => ({
        output: "ok",
        status: "success",
        summary: "ok",
      }),
    } as never);

    await db.upsertTool({
      createdAt: now,
      description: "Sub-agent",
      handlerConfig: {},
      handlerType: "sub_agent",
      id: SUB_AGENT_TOOL_ID,
      name: "sub_agent",
      updatedAt: now,
    });

    const tools = await resolveToolsFromStorage(await db.listTools(), db, [], {
      serverTools: { subAgent },
    });

    expect(tools.map((tool) => tool.name)).toContain("sub_agent");
  });
});
