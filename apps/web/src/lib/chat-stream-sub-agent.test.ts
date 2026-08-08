import { describe, expect, test } from "bun:test";
import {
  formatSubAgentSubtitle,
  formatSubAgentTitle,
  formatSubAgentToolResult,
  formatToolActionLabel,
  formatToolResult,
  isSubAgentTool,
  parseSubAgentResult,
} from "./chat-stream";

describe("sub_agent chat formatting", () => {
  test("isSubAgentTool matches name", () => {
    expect(isSubAgentTool("sub_agent")).toBe(true);
    expect(isSubAgentTool("bash")).toBe(false);
  });

  test("formatSubAgentTitle uses first line of task", () => {
    expect(
      formatSubAgentTitle({
        task: "Research Microsandbox integration\nwith more detail",
      })
    ).toBe("Research Microsandbox integration");
  });

  test("formatSubAgentTitle falls back when task missing", () => {
    expect(formatSubAgentTitle({})).toBe("Sub-agent");
  });

  test("formatSubAgentSubtitle prefers context while running", () => {
    expect(
      formatSubAgentSubtitle(
        {
          context: "Researching Microsandbox capabilities",
          task: "Research Microsandbox integration",
        },
        undefined,
        true
      )
    ).toBe("Researching Microsandbox capabilities");
  });

  test("formatSubAgentSubtitle uses Working when running without context", () => {
    expect(
      formatSubAgentSubtitle({ task: "Research Microsandbox" }, undefined, true)
    ).toBe("Working…");
  });

  test("formatSubAgentSubtitle prefers live activity while running", () => {
    expect(
      formatSubAgentSubtitle(
        { task: "Research Microsandbox" },
        undefined,
        true,
        "Reading SOUL.md"
      )
    ).toBe("Reading SOUL.md");
  });

  test("formatSubAgentSubtitle uses summary on success", () => {
    expect(
      formatSubAgentSubtitle(
        { task: "Research" },
        {
          output: "Full writeup…",
          status: "success",
          summary: "Two integration paths look promising.",
        },
        false
      )
    ).toBe("Two integration paths look promising.");
  });

  test("formatSubAgentSubtitle surfaces timeout and fail", () => {
    expect(
      formatSubAgentSubtitle(
        { task: "Research" },
        {
          error: "Sub-agent timed out.",
          output: "",
          status: "timeout",
          summary: "",
        },
        false
      )
    ).toBe("Sub-agent timed out.");

    expect(
      formatSubAgentSubtitle(
        { task: "Research" },
        {
          error: "Nested not allowed.",
          output: "",
          status: "fail",
          summary: "",
        },
        false
      )
    ).toBe("Nested not allowed.");
  });

  test("parseSubAgentResult rejects malformed payloads", () => {
    expect(parseSubAgentResult(null)).toBeNull();
    expect(parseSubAgentResult({ summary: "x" })).toBeNull();
  });

  test("formatSubAgentToolResult prefers output then summary", () => {
    expect(
      formatSubAgentToolResult({
        output: "Long body",
        status: "success",
        summary: "Short",
      })
    ).toBe("Long body");

    expect(
      formatSubAgentToolResult({
        output: "",
        status: "success",
        summary: "Short",
      })
    ).toBe("Short");
  });

  test("formatToolActionLabel and formatToolResult route through sub_agent helpers", () => {
    expect(formatToolActionLabel("sub_agent", { task: "Draft a plan" })).toBe(
      "Draft a plan"
    );

    expect(
      formatToolResult("sub_agent", {
        output: "Full",
        status: "success",
        summary: "Done",
      })
    ).toBe("Full");
  });
});
