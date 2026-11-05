import { describe, expect, test } from "bun:test";
import type { StoredWorkflow, WorkflowStep } from "@nakama/core";
import type { WorkflowBag, WorkflowRecord } from "./workflow-ops";
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

    let summarizeBag: WorkflowBag | null = null;
    const service = createWorkflowServiceStub(workflow);

    const agent = {
      executeTool: async (
        _profile: string,
        _name: string,
        args: WorkflowRecord
      ) => ({ ok: args.query, source: "tool" }),
      runWorkflowSummarize: async (
        _orgId: string,
        _profileId: string,
        _prompt: string,
        bag: WorkflowBag
      ) => {
        summarizeBag = bag;

        return "Summary from receipts";
      },
    };

    const runner = new WorkflowRunner(service, agent);
    const result = await runner.run("workflow_test");

    expect(result.output).toBe("Summary from receipts");
    expect(summarizeBag).not.toBeNull();

    if (!summarizeBag) {
      throw new Error("Summarize step did not receive a receipt bag");
    }

    expect(summarizeBag.steps.fetch).toEqual({ ok: "hello", source: "tool" });
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

    const runner = new WorkflowRunner(service, agent);
    const result = await runner.run("workflow_test");

    expect(result.error).toMatch(/compare/i);
    expect(summarizeCalled).toBe(false);
  });

  test("stops before summarize when a tool step returns an error envelope", async () => {
    const failingSteps: WorkflowStep[] = [
      {
        id: "fetch",
        input: { query: "news" },
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

    const updates: Array<{ input?: unknown; status: string }> = [];
    service.updateRunStep = async (_runId, _id, update) => {
      updates.push(update);
    };

    const runner = new WorkflowRunner(service, agent);
    const result = await runner.run("workflow_test");

    expect(result.error).toMatch(/cannot be executed locally/i);
    expect(summarizeCalled).toBe(false);
    expect(updates).toEqual([
      {
        error: "web_search cannot be executed locally.",
        input: { query: "news" },
        output: { error: "web_search cannot be executed locally." },
        status: "failed",
      },
    ]);
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
      ] satisfies WorkflowStep[],
    };

    const service = createWorkflowServiceStub(workflow);

    const runner = new WorkflowRunner(service, {
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
    async updateRunStep(
      _runId: string,
      _id: string,
      _update: {
        error?: string;
        input?: unknown;
        output?: unknown;
        status: string;
      }
    ) {},
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
  } satisfies StoredWorkflow;

  let writes = 0;
  let summaries = 0;

  const runner = new WorkflowRunner(createWorkflowServiceStub(workflow), {
    executeTool: async () => {
      writes++;

      return { changes: 0 };
    },
    runWorkflowSummarize: async () => {
      summaries++;

      return "done";
    },
  });

  const result = await runner.run(workflow.id);
  expect(result.error).toBeDefined();
  expect(writes).toBe(0);
  expect(summaries).toBe(0);
});

test("trying one step resolves earlier results and records no run", async () => {
  const service = createWorkflowServiceStub(createBaseWorkflow());
  let runsCreated = 0;
  service.createRun = async () => {
    runsCreated += 1;
    throw new Error("Trying a step must not create a run.");
  };

  const calls: WorkflowRecord[] = [];

  const runner = new WorkflowRunner(service, {
    executeTool: async (_profileId, _name, input) => {
      calls.push(input);

      return { ok: true };
    },
    runWorkflowSummarize: async () => "unused",
  });

  const result = await runner.executeDataStep(
    {
      id: "save",
      input: { text: "{{steps.fetch.text}}" },
      kind: "tool",
      tool: "echo_tool",
    },
    { input: {}, steps: { fetch: { text: "hello" } } },
    {
      orgId: "org_1",
      profileId: "profile_test",
      runId: "test_1",
      workflowId: "workflow_test",
    }
  );

  expect(result).toEqual({ input: { text: "hello" }, output: { ok: true } });
  expect(calls).toEqual([{ text: "hello" }]);
  expect(runsCreated).toBe(0);
});

describe("agent step triage", () => {
  const triage = {
    ...createBaseWorkflow(),
    steps: [
      {
        id: "github",
        kind: "compare",
        left: "{{input.from}}",
        onFail: "skip",
        op: "contains",
        right: "github.com",
      },
      {
        fields: {
          decision: "act | ignore",
          type: "security | mention | other",
        },
        id: "classify",
        kind: "agent",
        prompt: "Classify: {{input.subject}}",
      },
      {
        id: "should_act",
        kind: "compare",
        left: "{{steps.classify.decision}}",
        onFail: "skip",
        op: "eq",
        right: "act",
      },
      {
        id: "label",
        input: { label: "{{steps.classify.type}}" },
        kind: "tool",
        tool: "label_email",
      },
      { id: "summary", kind: "summarize", prompt: "Say what was done." },
    ],
  } satisfies StoredWorkflow;

  function setup(reply: string) {
    const service = createWorkflowServiceStub(triage);
    const statuses: Record<string, string> = {};
    const prompts: string[] = [];
    const toolCalls: WorkflowRecord[] = [];
    let summaryBag: WorkflowBag | null = null;

    service.updateRunStep = async (_runId, id, update) => {
      statuses[id] = update.status;
    };

    const runner = new WorkflowRunner(service, {
      executeTool: async (_profile, _name, input) => {
        toolCalls.push(input);

        return { labeled: true };
      },
      runWorkflowSummarize: async (_org, _profile, prompt, bag) => {
        prompts.push(prompt);

        if (prompt === "Say what was done.") {
          summaryBag = bag;

          return "Summary";
        }

        return reply;
      },
    });

    return {
      prompts,
      runner,
      statuses,
      summaryBag: () => summaryBag,
      toolCalls,
    };
  }

  test("classifies mid-run and acts on the decision", async () => {
    const t = setup('```json\n{"type":"security","decision":"act"}\n```');

    const result = await t.runner.run(triage.id, {
      from: "notifications@github.com",
      subject: "Security advisory",
    });

    expect(result).toMatchObject({ output: "Summary", status: "completed" });
    expect(t.prompts[0]).toContain("Classify: Security advisory");
    expect(t.toolCalls).toEqual([{ label: "security" }]);
    expect(t.summaryBag()?.steps.classify).toEqual({
      decision: "act",
      type: "security",
    });
  });

  test("ignore ends the run as skipped before the action", async () => {
    const t = setup('{"type":"other","decision":"ignore"}');

    const result = await t.runner.run(triage.id, {
      from: "notifications@github.com",
      subject: "Thread update",
    });

    expect(result.status).toBe("skipped");
    expect(result.error).toBeUndefined();
    expect(t.toolCalls).toEqual([]);
    expect(t.summaryBag()).toBeNull();
    expect(t.statuses.step_record_2).toBe("skipped");
  });

  test("a sender outside github.com skips the agent", async () => {
    const t = setup('{"type":"security","decision":"act"}');

    const result = await t.runner.run(triage.id, {
      from: "friend@example.com",
      subject: "Hi",
    });

    expect(result.status).toBe("skipped");
    expect(t.prompts).toEqual([]);
    expect(t.toolCalls).toEqual([]);
  });

  test("a reply without the declared fields fails the run before the action", async () => {
    const t = setup("I think you should act.");

    const result = await t.runner.run(triage.id, {
      from: "notifications@github.com",
      subject: "Security advisory",
    });

    expect(result.error).toBeDefined();
    expect(t.toolCalls).toEqual([]);
    expect(t.statuses.step_record_1).toBe("failed");
  });
});
