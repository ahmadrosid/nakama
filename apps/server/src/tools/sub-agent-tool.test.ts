import { describe, expect, test } from "bun:test";
import type { SubAgentRunResult } from "./sub-agent-shared";
import {
  createSubAgentTool,
  runSubAgentTool,
  SUB_AGENT_TOOL_NAME,
} from "./sub-agent-tool";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";
const TOOL_CONTEXT = { orgId: ORG_ID, profileId: PROFILE_ID, agentDepth: 0 };

function createMockAgentService(
  handler: (input: unknown) => Promise<SubAgentRunResult>,
) {
  return {
    runSubAgentPrompt: handler,
  } as never;
}

describe("sub_agent tool", () => {
  test("returns success-shaped result from runner", async () => {
    const agent = createMockAgentService(async () => ({
      status: "success",
      summary: "Done",
      output: "Done",
    }));
    const tool = createSubAgentTool(agent);

    const result = await tool.run({ task: "Research competitors" }, TOOL_CONTEXT);

    expect(result.status).toBe("success");
    expect(result.summary).toBe("Done");
  });

  test("rejects nested sub-agent calls", async () => {
    const agent = createMockAgentService(async () => ({
      status: "success",
      summary: "nope",
      output: "nope",
    }));
    const tool = createSubAgentTool(agent);

    const result = await tool.run(
      { task: "nested" },
      { ...TOOL_CONTEXT, agentDepth: 1 },
    );

    expect(result.status).toBe("fail");
    expect(result.error).toContain("Nested sub-agent");
  });

  test("rejects whitespace-only task", async () => {
    const agent = createMockAgentService(async () => ({
      status: "success",
      summary: "nope",
      output: "nope",
    }));

    const result = await runSubAgentTool({ task: "   " }, TOOL_CONTEXT, agent);

    expect(result.status).toBe("fail");
    expect(result.error).toContain("task is required");
  });

  test("clamps timeoutMs before calling runner", async () => {
    let capturedTimeout: number | undefined;
    const agent = createMockAgentService(async (input) => {
      capturedTimeout = (input as { timeoutMs?: number }).timeoutMs;
      return { status: "success", summary: "ok", output: "ok" };
    });
    const tool = createSubAgentTool(agent);

    await tool.run({ task: "timed", timeoutMs: 999_999 }, TOOL_CONTEXT);

    expect(capturedTimeout).toBe(600_000);
  });

  test("exposes stable tool name", () => {
    expect(SUB_AGENT_TOOL_NAME).toBe("sub_agent");
  });
});
