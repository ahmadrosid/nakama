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
      buildWorkflowToolContext: () => ({}),
      resolveWorkflowExecutionTools: async () => [
        {
          name: "echo_tool",
          async run(args: Record<string, unknown>) {
            return { ok: args.query, source: "tool" };
          },
        },
      ],
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
      buildWorkflowToolContext: () => ({}),
      resolveWorkflowExecutionTools: async () => [
        {
          name: "echo_tool",
          async run() {
            return { value: 1 };
          },
        },
      ],
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
      buildWorkflowToolContext: () => ({}),
      resolveWorkflowExecutionTools: async () => [
        {
          name: "web_search",
          async run() {
            throw new Error(
              "web_search runs on the configured OpenAI or Anthropic provider and cannot be executed locally."
            );
          },
        },
      ],
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
