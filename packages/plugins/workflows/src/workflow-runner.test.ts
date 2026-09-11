import { describe, expect, test } from "bun:test";
import type { StoredWorkflow, WorkflowStep } from "@nakama/core";
import { WorkflowRunner } from "./workflow-runner";

describe("WorkflowRunner", () => {
  const steps: WorkflowStep[] = [
    {
      id: "fetch",
      input: { query: "hello" },
      kind: "tool",
      tool: "echo_tool",
    },
    {
      id: "check",
      kind: "compare",
      left: "{{steps.fetch.ok}}",
      op: "eq",
      right: "hello",
    },
    {
      id: "summary",
      kind: "summarize",
      prompt: "Summarize briefly.",
    },
  ];

  test("runs data steps in order and summarizes from receipt bag only", async () => {
    const workflow = { ...createBaseWorkflow(), steps };

    let summarizeBag: Record<string, unknown> | null = null;
    const service = createWorkflowServiceStub(workflow);
    const agent = {
      executeTool: async (
        _profile: string,
        _name: string,
        args: Record<string, unknown>
      ) => ({ ok: args.query, source: "tool" }),
      runWorkflowSummarize: async (
        _orgId: string,
        _profileId: string,
        _prompt: string,
        bag: Record<string, unknown>
      ) => {
        summarizeBag = bag;
        return "Summary from receipts";
      },
    };

    const runner = new WorkflowRunner(service as never, agent as never);
    const result = await runner.run("workflow_test");

    expect(result.output).toBe("Summary from receipts");
    expect(summarizeBag).not.toBeNull();
    expect(
      (summarizeBag as { steps?: Record<string, unknown> }).steps?.fetch
    ).toEqual({ ok: "hello", source: "tool" });
  });

  test("stops before summarize when compare fails", async () => {
    const failingSteps: WorkflowStep[] = [
      {
        id: "fetch",
        input: {},
        kind: "tool",
        tool: "echo_tool",
      },
      {
        id: "check",
        kind: "compare",
        left: "a",
        op: "eq",
        right: "b",
      },
      {
        id: "summary",
        kind: "summarize",
        prompt: "Never reached",
      },
    ];
    const workflow = {
      ...createBaseWorkflow(),
      steps: failingSteps,
    };

    let summarizeCalled = false;
    const service = createWorkflowServiceStub(workflow);
    const agent = {
      executeTool: async () => ({ value: 1 }),
      runWorkflowSummarize: async () => {
        summarizeCalled = true;
        return "nope";
      },
    };

    const runner = new WorkflowRunner(service as never, agent as never);
    const result = await runner.run("workflow_test");

    expect(result.error).toMatch(/compare/i);
    expect(summarizeCalled).toBe(false);
  });

  test("stops before summarize when a tool step returns an error envelope", async () => {
    const failingSteps: WorkflowStep[] = [
      {
        id: "fetch",
        input: {},
        kind: "tool",
        tool: "web_search",
      },
      {
        id: "summary",
        kind: "summarize",
        prompt: "Never reached",
      },
    ];
    const workflow = {
      ...createBaseWorkflow(),
      steps: failingSteps,
    };

    let summarizeCalled = false;
    const service = createWorkflowServiceStub(workflow);
    const agent = {
      executeTool: async () => ({
        error: "web_search cannot be executed locally.",
      }),
      runWorkflowSummarize: async () => {
        summarizeCalled = true;
        return "nope";
      },
    };

    const runner = new WorkflowRunner(service as never, agent as never);
    const result = await runner.run("workflow_test");

    expect(result.error).toMatch(/cannot be executed locally/i);
    expect(summarizeCalled).toBe(false);
  });

  test("compares template-shaped input strings without resolving them twice", async () => {
    const workflow = {
      ...createBaseWorkflow(),
      steps: [
        {
          expected: "{{input.expected}}",
          id: "check",
          kind: "assert",
          path: "input.actual",
        },
        { id: "summary", kind: "summarize", prompt: "Summarize" },
      ] as WorkflowStep[],
    };
    const service = createWorkflowServiceStub(workflow);
    const runner = new WorkflowRunner(service as never, {
      executeTool: async () => ({}),
      runWorkflowSummarize: async () => "done",
    });

    const result = await runner.run(workflow.id, {
      actual: "{{literal}}",
      expected: "{{literal}}",
    });

    expect(result).toMatchObject({ output: "done" });
  });
});

function createBaseWorkflow(): StoredWorkflow {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    description: "Test workflow",
    enabled: true,
    id: "workflow_test",
    name: "Test",
    orgId: "org_1",
    profileId: "profile_1",
    steps: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  };
}

function createWorkflowServiceStub(workflow: StoredWorkflow) {
  const runSteps: Array<{ id: string; stepId: string; kind: string }> = [];

  return {
    async completeRun(
      _runId: string,
      _workflowId: string,
      result: { output?: string; error?: string }
    ) {
      return {
        completedAt: "2026-01-01T00:00:01.000Z",
        error: result.error ?? null,
        id: "run_1",
        input: null,
        output: result.output ?? null,
        startedAt: "2026-01-01T00:00:00.000Z",
        status: result.error ? ("failed" as const) : ("completed" as const),
        steps: runSteps,
        workflowId: workflow.id,
      };
    },
    async createRun() {
      return {
        completedAt: null,
        error: null,
        id: "run_1",
        input: null,
        output: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "running" as const,
        workflowId: workflow.id,
      };
    },
    async createRunStep(_runId: string, step: WorkflowStep, position: number) {
      const record = {
        completedAt: null,
        error: null,
        id: `step_record_${position}`,
        input: null,
        kind: step.kind,
        output: null,
        runId: "run_1",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "running" as const,
        stepId: step.id,
      };
      runSteps.push(record);
      return record;
    },
    async get(id: string) {
      return id === workflow.id ? workflow : null;
    },
    async updateRunStep() {},
  };
}

test("missing extraction data stops before the database write and summary", async () => {
  const workflow = {
    ...createBaseWorkflow(),
    steps: [
      { id: "extract", kind: "template", template: "Extract five stories" },
      {
        id: "store",
        input: { params: ["{{steps.extract.stories}}"] },
        kind: "tool",
        tool: "sqlite",
      },
      { id: "summary", kind: "summarize", prompt: "Summarize" },
    ],
  } as StoredWorkflow;
  let writes = 0;
  let summaries = 0;
  const runner = new WorkflowRunner(
    createWorkflowServiceStub(workflow) as never,
    {
      executeTool: async () => {
        writes++;
        return { changes: 0 };
      },
      runWorkflowSummarize: async () => {
        summaries++;
        return "done";
      },
    }
  );
  const result = await runner.run(workflow.id);
  expect(result.error).toBeDefined();
  expect(writes).toBe(0);
  expect(summaries).toBe(0);
});
