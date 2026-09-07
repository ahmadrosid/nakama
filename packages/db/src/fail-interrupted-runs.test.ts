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

    // Two runs, not three: the step is not a run and the finished one is not touched.
    expect(settled).toBe(2);

    const automationRuns = await db.listAutomationRuns("auto_a", 10);
    expect(automationRuns[0]?.status).toBe("failed");
    expect(automationRuns[0]?.error).toBeTruthy();
    expect(automationRuns[0]?.completedAt).toBeTruthy();

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
