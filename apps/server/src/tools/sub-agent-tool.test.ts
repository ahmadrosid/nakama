import { describe, expect, test } from "bun:test";
import { canRunToolCallsInParallel } from "@nakama/agent";
import type { AgentService } from "../services/agent-service";
import { formatToolActivityLabel } from "./sub-agent-activity";
import type { SubAgentRunResult } from "./sub-agent-shared";
import { createSubAgentTool, runSubAgentTool } from "./sub-agent-tool";

const ORG_ID = "org_test";

const PROFILE_ID = "profile_default";

const TOOL_CONTEXT = { agentDepth: 0, orgId: ORG_ID, profileId: PROFILE_ID };

function createMockAgentService(
  handler: (
    input: Parameters<AgentService["runSubAgentPrompt"]>[0]
  ) => Promise<SubAgentRunResult>
) {
  // SAFETY: Tests implement only runSubAgentPrompt, the sole method used by this tool.
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

    expect(result).toMatchObject({ status: "success", summary: "Done" });
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

    expect(result).toMatchObject({
      error: expect.stringContaining("Nested sub-agent"),
      status: "fail",
    });
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
      capturedTimeout = input.timeoutMs;

      return { output: "ok", status: "success", summary: "ok" };
    });

    const tool = createSubAgentTool(agent);

    await tool.run({ task: "timed", timeoutMs: 999_999 }, TOOL_CONTEXT);

    expect(capturedTimeout).toBe(600_000);
  });

  test("inherits the trusted parent role, not a role supplied in tool arguments", async () => {
    for (const orgRole of ["admin", "member", undefined] as const) {
      let captured: unknown;

      const agent = createMockAgentService(async (input) => {
        captured = input;

        return { output: "ok", status: "success", summary: "ok" };
      });

      const input = { orgRole: "admin", task: "delegated" };
      await runSubAgentTool(input, { ...TOOL_CONTEXT, orgRole }, agent);

      expect(captured).toMatchObject({ orgRole });
    }
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

test("tool activity accepts missing details for every tool branch", () => {
  for (const tool of [
    "read_file",
    "search_files",
    "knowledge_base_search",
    "web_fetch",
    "web_search",
    "bash",
    "write_file",
    "write_docx",
    "edit_file",
    "delete_file",
    "custom_tool",
  ]) {
    expect(formatToolActivityLabel(tool)).toEqual(expect.any(String));
  }

  expect(
    formatToolActivityLabel("write_file", { path: "/tmp/report.md" })
  ).toBe("Writing report.md");
});
