import { describe, expect, test } from "bun:test";
import type { WorkflowRunRecord } from "@nakama/core/contract";
import { workflowRunsRefetchInterval } from "./use-workflows";

function run(
  id: string,
  status: WorkflowRunRecord["status"]
): WorkflowRunRecord {
  return {
    completedAt: status === "running" ? null : "2026-09-07T00:00:01.000Z",
    error: null,
    id,
    input: null,
    output: null,
    startedAt: "2026-09-07T00:00:00.000Z",
    status,
    workflowId: "wf_a",
  };
}

describe("workflowRunsRefetchInterval", () => {
  test("polls only while a run is in flight", () => {
    const interval = workflowRunsRefetchInterval([
      run("wfrun_live", "running"),
      run("wfrun_done", "completed"),
    ]);
    expect(interval).toBeGreaterThan(0);

    // The panel is open on history alone, so every settled state stops the timer.
    expect(
      workflowRunsRefetchInterval([
        run("wfrun_done", "completed"),
        run("wfrun_bad", "failed"),
      ])
    ).toBe(false);

    // First render has no data yet, and an empty list is a workflow never run.
    expect(workflowRunsRefetchInterval(undefined)).toBe(false);
    expect(workflowRunsRefetchInterval([])).toBe(false);
  });
});
