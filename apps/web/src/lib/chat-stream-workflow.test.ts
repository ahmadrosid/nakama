import { expect, test } from "bun:test";
import type { WorkflowRunRecord } from "@nakama/core";
import {
  buildWorkflowRunCard,
  parseRunWorkflowResult,
} from "./chat-stream-workflow";

test("a run a filter step skipped reads as skipped, not done", () => {
  const run: WorkflowRunRecord = {
    completedAt: "2026-01-01T00:00:01.000Z",
    error: null,
    id: "run_1",
    input: { from: "billing@stripe.com" },
    output: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "skipped",
    steps: [
      {
        completedAt: "2026-01-01T00:00:01.000Z",
        error: null,
        id: "receipt_1",
        input: { left: "billing@stripe.com", op: "contains", right: "github" },
        kind: "compare",
        output: { left: "billing@stripe.com", ok: false, right: "github" },
        runId: "run_1",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "skipped",
        stepId: "from_github",
      },
    ],
    workflowId: "workflow_1",
  };

  const parsed = parseRunWorkflowResult({ run, status: "skipped" });

  const card = buildWorkflowRunCard({
    isRunning: false,
    parsed,
    runs: [run],
    workflow: {
      enabled: true,
      name: "GitHub mail",
      steps: [
        {
          id: "from_github",
          kind: "compare",
          left: "{{input.from}}",
          onFail: "skip",
          op: "contains",
          right: "github",
        },
        { id: "summary", kind: "summarize", prompt: "Summarize" },
      ],
    },
  });

  expect(parsed?.status).toBe("skipped");
  expect(card.views.map((view) => view.status)).toEqual(["skipped", "pending"]);
  expect(card.views[0]?.meta).not.toBe("Done");
  expect(card.statusLabel).not.toMatch(/^(Done|Failed)/);
});
