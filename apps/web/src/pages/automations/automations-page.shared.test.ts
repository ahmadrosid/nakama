import { expect, test } from "bun:test";
import type { AutomationRunRecord } from "@nakama/core/contract";
import { automationRunMessages } from "./automations-page.shared";

test("run conversations retain tools and text and only animate a running run", () => {
  const run: AutomationRunRecord = {
    automationId: "automation",
    completedAt: null,
    error: null,
    id: "run",
    output: null,
    progress: [
      { content: "Check files", role: "user" },
      {
        content: "",
        role: "assistant",
        toolCalls: [
          { arguments: { command: "pwd" }, id: "call", name: "bash" },
        ],
      },
      {
        content: "",
        name: "bash",
        role: "tool",
        toolCallId: "call",
        toolStartedAt: 1000,
      },
    ],
    startedAt: "2026-10-01T00:00:00Z",
    status: "running",
  };

  const live = automationRunMessages(run);
  expect(live.map((item) => item.role)).toEqual(["user", "tool"]);
  expect(live[1]).toMatchObject({
    toolInput: { command: "pwd" },
    toolStatus: "running",
  });
  run.progress!.push({ content: "Result", role: "assistant" });
  expect(automationRunMessages(run).at(-1)?.streaming).toBe(true);
  run.status = "completed";
  const done = automationRunMessages(run);
  expect(done[1]).toMatchObject({ id: live[1]!.id, toolStatus: "done" });
  expect(done.at(-1)).toMatchObject({ content: "Result", streaming: false });
  run.status = "failed";
  run.error = "Disconnected";
  expect(automationRunMessages(run).at(-1)).toMatchObject({
    content: run.error,
    failed: true,
  });
  run.progress = undefined;
  run.error = null;
  run.output = "Legacy output";
  expect(automationRunMessages(run)).toHaveLength(1);
  expect(automationRunMessages(run)[0]?.content).toBe(run.output);
  run.status = "running";
  run.output = null;
  expect(automationRunMessages(run)[0]?.streaming).toBe(true);
});
