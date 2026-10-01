import { expect, test } from "bun:test";
import type { ChatMessage } from "@nakama/core/contract";
import { automationProgressLines } from "./automations-page.shared";

test("compact progress groups completed tools, retains text order, and exposes failures", () => {
  const active: Extract<ChatMessage, { role: "tool" }> = {
    content: "",
    name: "bash",
    role: "tool",
    toolCallId: "b",
    toolStartedAt: 1000,
  };
  const messages: ChatMessage[] = [
    { content: "Checking files", role: "assistant" },
    {
      content: "",
      role: "assistant",
      toolCalls: [
        { arguments: { path: "README.md" }, id: "a", name: "read_file" },
        { arguments: { command: "bun test" }, id: "b", name: "bash" },
      ],
    },
    {
      content: '"Large successful result"',
      name: "read_file",
      role: "tool",
      toolCallId: "a",
      toolCompletedAt: 2000,
      toolStartedAt: 1000,
    },
    active,
  ];
  const running = automationProgressLines(messages);
  expect(running.map((line) => line.type)).toEqual(["text", "tool"]);
  expect(running[1]?.text).toContain("bash");
  expect(running[1]?.text).toContain("bun test");
  expect(running[1]?.text).toContain("1 done");
  expect(JSON.stringify(running)).not.toContain("Large successful result");

  active.content = JSON.stringify({ exitCode: 1, stderr: "Test failed" });
  active.toolCompletedAt = 3000;
  messages.push({ content: "Fixing the test", role: "assistant" });
  const failed = automationProgressLines(messages);
  expect(failed.map((line) => line.type)).toEqual([
    "text",
    "error",
    "tool",
    "text",
  ]);
  expect(failed[1]?.text).toContain("bash");
  expect(failed[2]?.text).toContain("2 tools completed");
  expect(failed[2]?.text).toContain("1 failed");
  expect(failed.at(-1)?.text).toBe("Fixing the test");

  active.content = JSON.stringify({ exitCode: 0 });
  expect(automationProgressLines(messages).map((line) => line.type)).toEqual([
    "text",
    "tool",
    "text",
  ]);
  expect(automationProgressLines([])).toEqual([]);
});
