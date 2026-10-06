import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./index";

describe("failInterruptedRuns", () => {
  test("settles runs a dead process left running and leaves finished ones alone", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      createdAt: now,
      id: "profile_a",
      isSuper: false,
      model: null,
      name: "A",
      systemPrompt: "a",
      updatedAt: now,
    });
    await db.upsertAutomation({
      createdAt: now,
      definition: { trigger: { type: "manual" } },
      enabled: true,
      id: "auto_a",
      name: "Auto",
      profileId: "profile_a",
      updatedAt: now,
      version: 1,
    });
    await db.upsertWorkflow({
      createdAt: now,
      definition: { steps: [] },
      enabled: true,
      id: "wf_a",
      name: "Flow",
      profileId: "profile_a",
      updatedAt: now,
      version: 1,
    });

    await db.insertAutomationRun({
      automationId: "auto_a",
      completedAt: null,
      error: null,
      id: "arun_live",
      output: null,
      startedAt: now,
      status: "running",
    });
    await db.insertWorkflowRun({
      completedAt: null,
      error: null,
      id: "wfrun_live",
      input: "{}",
      output: null,
      startedAt: now,
      status: "running",
      workflowId: "wf_a",
    });
    await db.insertWorkflowRunStep({
      completedAt: null,
      error: null,
      id: "wfstep_live",
      input: null,
      kind: "tool",
      output: null,
      position: 0,
      runId: "wfrun_live",
      startedAt: now,
      status: "running",
      stepId: "fetch",
    });
    await db.insertWorkflowRun({
      completedAt: now,
      error: null,
      id: "wfrun_done",
      input: "{}",
      output: "done",
      startedAt: now,
      status: "completed",
      workflowId: "wf_a",
    });

    const settled = await db.failInterruptedRuns();

    // Workflow runs only: automation runs are resumed, not failed, on boot.
    expect(settled).toBe(1);

    const automationRuns = await db.listAutomationRuns("auto_a", 10);
    expect(automationRuns[0]?.status).toBe("running");

    const workflowRuns = await db.listWorkflowRuns("wf_a", 10);
    const live = workflowRuns.find((run) => run.id === "wfrun_live");
    expect(live?.status).toBe("failed");
    expect(live?.error).toBeTruthy();
    expect(live?.completedAt).toBeTruthy();

    const steps = await db.listWorkflowRunSteps("wfrun_live");
    expect(steps[0]?.status).toBe("failed");
    expect(steps[0]?.error).toBeTruthy();

    const done = workflowRuns.find((run) => run.id === "wfrun_done");
    expect(done?.status).toBe("completed");
    expect(done?.error).toBeNull();
    expect(done?.output).toBe("done");
  });
});

describe("claimInterruptedAutomationRuns", () => {
  async function setup() {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertProfile({
      createdAt: now,
      id: "profile_a",
      isSuper: false,
      model: null,
      name: "A",
      systemPrompt: "a",
      updatedAt: now,
    });
    await db.upsertAutomation({
      createdAt: now,
      definition: { trigger: { type: "manual" } },
      enabled: true,
      id: "auto_a",
      name: "Auto",
      profileId: "profile_a",
      updatedAt: now,
      version: 1,
    });
    for (const [id, status] of [
      ["arun_live", "running"],
      ["arun_done", "completed"],
    ] as const) {
      await db.insertAutomationRun({
        automationId: "auto_a",
        completedAt: status === "running" ? null : now,
        error: null,
        id,
        output: null,
        startedAt: now,
        status,
      });
    }
    return db;
  }

  test("returns running runs for resume and stops after the limit", async () => {
    const db = await setup();

    expect(await db.claimInterruptedAutomationRuns(2)).toEqual([
      { automationId: "auto_a", id: "arun_live" },
    ]);
    expect(await db.claimInterruptedAutomationRuns(2)).toHaveLength(1);
    expect(await db.claimInterruptedAutomationRuns(2)).toEqual([]);

    const runs = await db.listAutomationRuns("auto_a", 10);
    expect(runs.find((run) => run.id === "arun_live")?.status).toBe("failed");
    expect(runs.find((run) => run.id === "arun_done")?.status).toBe(
      "completed"
    );
  });

  test("keeps tool steps in order and records results", async () => {
    const db = await setup();
    const now = new Date().toISOString();
    const step = (toolCallId: string, position: number) => ({
      args: "{}",
      completedAt: null,
      position,
      result: null,
      runId: "arun_live",
      startedAt: now,
      status: "running" as const,
      toolCallId,
      toolGroupId: "group_1",
      toolName: "web_search",
    });

    await db.insertAutomationRunStep(step("call_1", 0));
    await db.insertAutomationRunStep(step("call_2", 1));
    await db.completeAutomationRunStep("arun_live", "call_1", '{"ok":1}', now);

    const steps = await db.listAutomationRunSteps("arun_live");
    expect(steps.map((item) => [item.toolCallId, item.status])).toEqual([
      ["call_1", "completed"],
      ["call_2", "running"],
    ]);
    expect(steps[0]?.result).toBe('{"ok":1}');
  });
});
