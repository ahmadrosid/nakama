import { describe, expect, test } from "bun:test";
import { canRunToolCallsInParallel } from "@nakama/agent";
import type { SubAgentRunResult } from "./sub-agent-shared";
import { createSubAgentTool, runSubAgentTool } from "./sub-agent-tool";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";
const TOOL_CONTEXT = { agentDepth: 0, orgId: ORG_ID, profileId: PROFILE_ID };

function createMockAgentService(
  handler: (input: unknown) => Promise<SubAgentRunResult>
) {
  return {
    runSubAgentPrompt: handler,
  } as never;
}

describe("sub_agent tool", () => {
  test("returns success-shaped result from runner", async () => {
    const agent = createMockAgentService(async () => ({
      output: "Done",
      status: "success",
      summary: "Done",
    }));
    const tool = createSubAgentTool(agent);

    const result = await tool.run(
      { task: "Research competitors" },
      TOOL_CONTEXT
    );

    expect(result.status).toBe("success");
    expect(result.summary).toBe("Done");
  });

  test("rejects nested sub-agent calls", async () => {
    const agent = createMockAgentService(async () => ({
      output: "nope",
      status: "success",
      summary: "nope",
    }));
    const tool = createSubAgentTool(agent);

    const result = await tool.run(
      { task: "nested" },
      { ...TOOL_CONTEXT, agentDepth: 1 }
    );

    expect(result.status).toBe("fail");
    expect(result.error).toContain("Nested sub-agent");
  });

  test("rejects whitespace-only task", async () => {
    const agent = createMockAgentService(async () => ({
      output: "nope",
      status: "success",
      summary: "nope",
    }));

    const result = await runSubAgentTool({ task: "   " }, TOOL_CONTEXT, agent);

    expect(result.status).toBe("fail");
    expect(result.error).toContain("task is required");
  });

  test("clamps timeoutMs before calling runner", async () => {
    let capturedTimeout: number | undefined;
    const agent = createMockAgentService(async (input) => {
      capturedTimeout = (input as { timeoutMs?: number }).timeoutMs;
      return { output: "ok", status: "success", summary: "ok" };
    });
    const tool = createSubAgentTool(agent);

    await tool.run({ task: "timed", timeoutMs: 999_999 }, TOOL_CONTEXT);

    expect(capturedTimeout).toBe(600_000);
  });

  test("is parallelSafe so sibling sub-agents can run concurrently from the parent", () => {
    const tool = createSubAgentTool(
      createMockAgentService(async () => ({
        output: "ok",
        status: "success",
        summary: "ok",
      }))
    );

    expect(tool.parallelSafe).toBe(true);
    expect(
      canRunToolCallsInParallel(
        [tool],
        [
          { arguments: { task: "first" }, id: "a", name: "sub_agent" },
          { arguments: { task: "second" }, id: "b", name: "sub_agent" },
        ]
      )
    ).toBe(true);
  });
});
