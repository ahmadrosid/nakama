import { describe, expect, test } from "bun:test";
import type { WorkflowStep } from "./contract";
import {
  buildReceiptBag,
  executeAssert,
  executeCompare,
  getPathValue,
  missingWorkflowTools,
  parseUnknownWorkflowToolError,
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

  test("missingWorkflowTools lists unique tool steps the profile cannot run", () => {
    const steps: WorkflowStep[] = [
      {
        id: "news",
        input: { url: "https://example.com" },
        kind: "tool",
        tool: "web_fetch",
      },
      {
        id: "tech",
        input: { url: "https://example.com" },
        kind: "tool",
        tool: "web_fetch",
      },
      { id: "search", input: {}, kind: "tool", tool: "web_search" },
      { id: "summary", kind: "summarize", prompt: "Summarize" },
    ];

    expect(missingWorkflowTools(steps, new Set(["web_fetch"]))).toEqual([]);
    expect(missingWorkflowTools(steps, new Set())).toEqual(["web_fetch"]);
    expect(
      parseUnknownWorkflowToolError(
        "Tool step news references unknown tool: web_fetch"
      )
    ).toBe("web_fetch");
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

  test("validateWorkflowSteps names missing step fields instead of crashing", () => {
    expect(() =>
      validateWorkflowSteps(
        [
          {
            id: "fetch",
            input: { query: "news" },
            tool: "web_search",
            type: "tool",
          },
          { id: "summarize", instruction: "Brief.", type: "summarize" },
        ] as never,
        new Set(["web_search"])
      )
    ).toThrow(/use kind instead/i);

    expect(() =>
      validateWorkflowSteps(
        [
          {
            id: "fetch",
            input: { query: "news" },
            kind: "tool",
            tool: "web_search",
          },
          {
            id: "compare",
            inputs: ["fetch"],
            instruction: "Rank items.",
            kind: "compare",
          },
          { id: "summarize", kind: "summarize", prompt: "Brief." },
        ] as never,
        new Set(["web_search"])
      )
    ).toThrow(/invalid op: undefined\. Use eq \| near \| contains/i);

    expect(() =>
      validateWorkflowSteps(
        [
          {
            id: "fetch",
            input: { query: "news" },
            kind: "tool",
            tool: "web_search",
          },
          {
            id: "compare",
            kind: "compare",
            left: "{{steps.fetch}}",
            op: "contains",
            right: "news",
          },
          {
            id: "summarize",
            instruction: "Write a brief.",
            kind: "summarize",
          },
        ] as never,
        new Set(["web_search"])
      )
    ).toThrow(/use prompt instead/i);
  });
});
