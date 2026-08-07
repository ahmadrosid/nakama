import { describe, expect, test } from "bun:test";
import {
  commandLooksLikeCursorAgent,
  formatCodingAgentBashStdout,
  looksLikeCursorAgentStreamJson,
  summarizeCursorAgentStreamJson,
} from "./cursor-agent-output";

describe("cursor-agent-output", () => {
  test("detects Cursor stream-json NDJSON", () => {
    const sample = [
      '{"type":"system","subtype":"init","model":"composer-2","cwd":"/tmp/repo"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Looking at the repo."}]}}',
    ].join("\n");

    expect(looksLikeCursorAgentStreamJson(sample)).toBe(true);
    expect(looksLikeCursorAgentStreamJson("plain text answer")).toBe(false);
  });

  test("summarizes assistant text, tools, and result from the end of a long stream", () => {
    const noise = Array.from({ length: 200 }, (_, i) =>
      JSON.stringify({
        type: "tool_call",
        subtype: "started",
        tool_call: {
          readToolCall: { args: { path: `noise/file-${i}.ts` } },
        },
      }),
    ).join("\n");

    const stdout = [
      '{"type":"system","subtype":"init","model":"composer-2","cwd":"/tmp/repo","apiKeySource":"login"}',
      noise,
      '{"type":"assistant","message":{"content":[{"type":"text","text":"I fixed the bug in auth.ts."}]}}',
      '{"type":"tool_call","subtype":"completed","tool_call":{"editToolCall":{"args":{"path":"src/auth.ts"}}}}',
      '{"type":"result","subtype":"success","result":"Updated auth.ts and verified tests.","duration_ms":1234}',
    ].join("\n");

    const summary = summarizeCursorAgentStreamJson(stdout, 0);

    expect(summary).toContain("# Cursor Agent result");
    expect(summary).toContain("model=composer-2");
    expect(summary).toContain("exitCode=0");
    expect(summary).toContain("I fixed the bug in auth.ts.");
    expect(summary).toContain("src/auth.ts");
    expect(summary).toContain("Updated auth.ts and verified tests.");
    expect(summary).toContain("durationMs=1234");
    expect(summary.length).toBeLessThan(stdout.length);
  });

  test("formatCodingAgentBashStdout appends log path and keep-tails plain text", () => {
    const longText = `${"x".repeat(30_000)}FINAL_ANSWER`;
    const formatted = formatCodingAgentBashStdout(longText, {
      logPath: "artifacts/coding-agent-runs/run.log",
      exitCode: 0,
    });

    expect(formatted).toContain("FINAL_ANSWER");
    expect(formatted).toContain("Full coding-agent log: artifacts/coding-agent-runs/run.log");
    expect(formatted.startsWith("...[truncated]")).toBe(true);
  });

  test("commandLooksLikeCursorAgent matches argv0 agent paths", () => {
    expect(commandLooksLikeCursorAgent("agent -p 'hi' --yolo")).toBe(true);
    expect(commandLooksLikeCursorAgent("./agent -p hi")).toBe(true);
    expect(commandLooksLikeCursorAgent("/usr/local/bin/agent -p hi")).toBe(true);
    expect(commandLooksLikeCursorAgent("cd repo && agent -p hi")).toBe(false);
    expect(commandLooksLikeCursorAgent("codex exec 'hi'")).toBe(false);
  });
});
