import { describe, expect, test } from "bun:test";
import { SUB_AGENT_TOOL_ID } from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { ensureSubAgentToolDefinition } from "./seed";

describe("ensureSubAgentToolDefinition", () => {
  test("upserts sub_agent tool definition", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensureSubAgentToolDefinition(db);
    await ensureSubAgentToolDefinition(db);

    const tool = await db.getTool(SUB_AGENT_TOOL_ID);

    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("sub_agent");
    expect(tool?.handlerType).toBe("sub_agent");
  });
});
