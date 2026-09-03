import { describe, expect, test } from "bun:test";
import type { WorkflowStep } from "./contract";
import {
  buildReceiptBag,
  executeAssert,
  executeCompare,
  getPathValue,
  resolveTemplateString,
  resolveWorkflowValue,
  validateWorkflowSteps,
} from "./workflow-ops";

describe("workflow-ops", () => {
  const bag = buildReceiptBag(
    { range: "last_week" },
    {
      fetch_a: { revenue: 100 },
      fetch_b: { revenue: 100 },
    }
  );

  test("resolves input and step templates", () => {
    expect(getPathValue(bag, "input.range")).toBe("last_week");
    expect(getPathValue(bag, "steps.fetch_a.revenue")).toBe(100);
    expect(resolveWorkflowValue("{{steps.fetch_a.revenue}}", bag)).toBe(100);
    expect(
      resolveTemplateString(
        "Range={{input.range}} revenue={{steps.fetch_a.revenue}}",
        bag
      )
    ).toBe("Range=last_week revenue=100");
  });

  test("compare eq and near", () => {
    expect(executeCompare({ left: 100, op: "eq", right: 100 }).ok).toBe(true);
    expect(
      executeCompare({ left: 100, op: "near", right: 101, tolerance: 2 }).ok
    ).toBe(true);
    expect(
      executeCompare({ left: 100, op: "near", right: 105, tolerance: 2 }).ok
    ).toBe(false);
    expect(
      executeCompare({ left: "hello world", op: "contains", right: "world" }).ok
    ).toBe(true);
  });

  test("assert passes and fails", () => {
    expect(
      executeAssert({
        bag,
        expected: 100,
        path: "steps.fetch_a.revenue",
      }).ok
    ).toBe(true);
    expect(
      executeAssert({
        bag,
        expected: 99,
        path: "steps.fetch_a.revenue",
      }).ok
    ).toBe(false);
  });

  test("validateWorkflowSteps enforces summarize last and tool names", () => {
    const steps: WorkflowStep[] = [
      {
        id: "fetch_a",
        input: { query: "{{input.range}}" },
        kind: "tool",
        tool: "web_search",
      },
      {
        id: "compare",
        kind: "compare",
        left: "{{steps.fetch_a}}",
        op: "contains",
        right: "ok",
      },
      {
        id: "summary",
        kind: "summarize",
        prompt: "Summarize the receipts.",
      },
    ];

    validateWorkflowSteps(steps, new Set(["web_search"]));
    expect(() => validateWorkflowSteps(steps, new Set(["read_file"]))).toThrow(
      /unknown tool/i
    );
    expect(() =>
      validateWorkflowSteps(
        [
          steps[0]!,
          { id: "summary_early", kind: "summarize", prompt: "Early" },
          steps[1]!,
          {
            id: "late_tool",
            input: {},
            kind: "tool",
            tool: "web_search",
          },
        ],
        new Set(["web_search"])
      )
    ).toThrow(/summarize step must be the last/i);
  });
});
