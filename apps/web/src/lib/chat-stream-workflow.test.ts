import { describe, expect, test } from "bun:test";
import type { WorkflowRunRecord, WorkflowStep } from "@nakama/core/contract";
import { formatToolActionLabel, formatToolResult } from "./chat-stream";
import {
  activeWorkflowStepIndex,
  buildWorkflowStepViews,
  describeWorkflowStep,
  formatListWorkflowsToolResult,
  formatWorkflowRunStatusLabel,
  humanizeWorkflowStepId,
  isListWorkflowsTool,
  isRunWorkflowTool,
  parseListWorkflowsResult,
  parseRunWorkflowResult,
  parseWorkflowId,
} from "./chat-stream-workflow";

const steps: WorkflowStep[] = [
  {
    id: "prep_work",
    input: { url: "https://books.example" },
    kind: "tool",
    tool: "web_fetch",
  },
  { expected: 0, id: "cash", kind: "assert", path: "steps.prep.diff" },
  { id: "summary", kind: "summarize", prompt: "Write the close package." },
];

describe("chat-stream-workflow", () => {
  test("isRunWorkflowTool matches name", () => {
    expect(isRunWorkflowTool("run_workflow")).toBe(true);
    expect(isRunWorkflowTool("create_workflow")).toBe(false);
    expect(isListWorkflowsTool("list_workflows")).toBe(true);
  });

  test("parseListWorkflowsResult reads summaries", () => {
    const listed = parseListWorkflowsResult([
      {
        description: "Fetches BBC News and writes a brief.",
        enabled: true,
        id: "workflow_1",
        lastRunAt: "2026-09-05T01:00:00.000Z",
        name: "Morning Brief",
        stepCount: 4,
      },
    ]);

    expect(listed).toEqual([
      {
        description: "Fetches BBC News and writes a brief.",
        enabled: true,
        id: "workflow_1",
        lastRunAt: "2026-09-05T01:00:00.000Z",
        name: "Morning Brief",
        stepCount: 4,
      },
    ]);
  });

  test("formatListWorkflowsToolResult is one line per workflow", () => {
    expect(
      formatListWorkflowsToolResult([
        {
          enabled: true,
          id: "workflow_1",
          lastRunAt: null,
          name: "Morning Brief",
          stepCount: 4,
        },
      ])
    ).toBe("Morning Brief · 4 steps");
    expect(formatListWorkflowsToolResult([])).toBe("None");
    expect(formatListWorkflowsToolResult({ error: "nope" })).toBeNull();
    expect(formatToolActionLabel("list_workflows")).toBe("Listed workflows");
    expect(
      formatToolResult("list_workflows", [
        {
          enabled: true,
          id: "workflow_1",
          name: "Morning Brief",
          stepCount: 1,
        },
      ])
    ).toBe("Morning Brief · 1 step");
  });

  test("parseWorkflowId reads input", () => {
    expect(parseWorkflowId({ workflowId: " workflow_1 " })).toBe("workflow_1");
    expect(parseWorkflowId({})).toBeNull();
  });

  test("parseRunWorkflowResult reads run payload", () => {
    const parsed = parseRunWorkflowResult({
      error: null,
      name: "Month-End Close",
      output: "Done",
      run: {
        id: "wfrun_1",
        startedAt: "2026-09-05T00:00:00.000Z",
        status: "completed",
        workflowId: "workflow_1",
      },
      status: "completed",
      workflowId: "workflow_1",
    });

    expect(parsed?.name).toBe("Month-End Close");
    expect(parsed?.run?.id).toBe("wfrun_1");
    expect(parsed?.status).toBe("completed");
  });

  test("buildWorkflowStepViews maps receipts", () => {
    const views = buildWorkflowStepViews(steps, {
      ...runRecord("live", "running", "2026-09-05T01:00:00.000Z"),
      steps: [
        {
          completedAt: "2026-09-05T01:00:01.000Z",
          error: null,
          id: "s1",
          input: null,
          kind: "tool",
          output: { output: "1,284 GL" },
          runId: "live",
          startedAt: "2026-09-05T01:00:00.000Z",
          status: "completed",
          stepId: "prep_work",
        },
        {
          completedAt: null,
          error: null,
          id: "s2",
          input: null,
          kind: "assert",
          output: null,
          runId: "live",
          startedAt: "2026-09-05T01:00:02.000Z",
          status: "running",
          stepId: "cash",
        },
      ],
    });

    expect(views.map((step) => step.status)).toEqual([
      "completed",
      "running",
      "pending",
    ]);
    expect(views[0]?.meta).toBe("1,284 GL");
    expect(views[0]?.tag).toBe("books.example");
    expect(views[0]?.kind).toBe("tool");
    expect(views[0]?.tool).toBe("web_fetch");
    expect(views[2]?.kind).toBe("summarize");
    expect(activeWorkflowStepIndex(views)).toBe(1);
  });

  test("buildWorkflowStepViews marks the next pending step running on a live run", () => {
    const views = buildWorkflowStepViews(steps, {
      ...runRecord("live", "running", "2026-09-05T01:00:00.000Z"),
      steps: [
        {
          completedAt: "2026-09-05T01:00:01.000Z",
          error: null,
          id: "s1",
          input: null,
          kind: "tool",
          output: { output: "ok" },
          runId: "live",
          startedAt: "2026-09-05T01:00:00.000Z",
          status: "completed",
          stepId: "prep_work",
        },
      ],
    });

    expect(views.map((step) => step.status)).toEqual([
      "completed",
      "running",
      "pending",
    ]);
  });

  test("fetch receipts show size instead of body", () => {
    const views = buildWorkflowStepViews(steps, {
      ...runRecord("done", "completed", "2026-09-05T01:00:00.000Z"),
      steps: [
        {
          completedAt: "2026-09-05T01:00:01.000Z",
          error: null,
          id: "s1",
          input: null,
          kind: "tool",
          output: {
            bytes: 378_119,
            content: "[Skip to content](#bbc-main)\n\nBritish Broadcasting…",
          },
          runId: "done",
          startedAt: "2026-09-05T01:00:00.000Z",
          status: "completed",
          stepId: "prep_work",
        },
        {
          completedAt: "2026-09-05T01:00:03.000Z",
          error: null,
          id: "s3",
          input: null,
          kind: "summarize",
          output:
            "# Morning Brief — 5 September 2026\n\n## Key developments\n1. **US strikes**",
          runId: "done",
          startedAt: "2026-09-05T01:00:02.000Z",
          status: "completed",
          stepId: "summary",
        },
      ],
    });

    expect(views[0]?.meta).toBe("369 KB");
    expect(views[2]?.meta).toBe("Morning Brief — 5 September 2026");
  });

  test("formatWorkflowRunStatusLabel covers run states", () => {
    expect(formatWorkflowRunStatusLabel("failed", false, 1, 4)).toBe(
      "Failed · step 2 of 4"
    );
    expect(formatWorkflowRunStatusLabel("running", true, 0, 4)).toBe(
      "Running · step 1 of 4"
    );
    expect(formatWorkflowRunStatusLabel("completed", false, 3, 4)).toBe(
      "Done · 4 of 4"
    );
    expect(formatWorkflowRunStatusLabel("off", false, 0, 4)).toBe("Off");
  });

  test("describeWorkflowStep and titles stay human", () => {
    expect(humanizeWorkflowStepId("prep_work")).toBe("Prep Work");
    expect(describeWorkflowStep(steps[0]!)).toBe("Web Fetch");
  });
});

function runRecord(
  id: string,
  status: WorkflowRunRecord["status"],
  startedAt: string
): WorkflowRunRecord {
  return {
    completedAt: null,
    error: null,
    id,
    input: null,
    output: null,
    startedAt,
    status,
    workflowId: "workflow_1",
  };
}
