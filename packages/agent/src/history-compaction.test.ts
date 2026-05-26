import { describe, expect, test } from "bun:test";
import type { ChatCompletionResult, ChatMessage, ProviderClient } from "@tinyclaw/core";
import {
  buildCompactionPrompt,
  compactHistory,
  estimateHistoryTokens,
  isOverflow,
  pruneToolOutputs,
  selectCompactionRange,
  usableContextTokens,
} from "./history-compaction";

const compaction = {
  contextWindow: 100_000,
  maxOutputTokens: 8_192,
};

function repeat(char: string, count: number): string {
  return char.repeat(count);
}

function createToolMessage(content: string): ChatMessage {
  return {
    role: "tool",
    toolCallId: "call_1",
    name: "read",
    content,
  };
}

describe("history compaction", () => {
  test("detects overflow against reserved context budget", () => {
    const usable = usableContextTokens(compaction);

    expect(isOverflow(usable - 1, compaction)).toBe(false);
    expect(isOverflow(usable, compaction)).toBe(true);
  });

  test("prunes old tool outputs while protecting recent turns", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "turn 1" },
      createToolMessage(repeat("a", 200_000)),
      { role: "assistant", content: "done 1" },
      { role: "user", content: "turn 2" },
      createToolMessage(repeat("b", 10_000)),
      { role: "assistant", content: "done 2" },
      { role: "user", content: "turn 3" },
      createToolMessage(repeat("c", 10_000)),
      { role: "assistant", content: "done 3" },
      { role: "user", content: "turn 4" },
      { role: "assistant", content: "done 4" },
    ];

    const result = pruneToolOutputs(messages);

    expect(result.prunedTokens).toBeGreaterThan(0);
    expect(messages[1]?.role === "tool" && messages[1].content).toContain("truncated");
    expect(messages[10]?.role === "assistant" && messages[10].content).toBe("done 4");
  });

  test("selects only the head for summarization", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "one" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "two" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "three" },
      { role: "assistant", content: "a3" },
    ];

    const selected = selectCompactionRange(messages);

    expect(selected.tailStartIndex).toBe(2);
    expect(selected.head).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "a1" },
    ]);
  });

  test("builds anchored compaction prompts from previous summaries", () => {
    const prompt = buildCompactionPrompt("Previous task summary");

    expect(prompt).toContain("<previous-summary>");
    expect(prompt).toContain("Previous task summary");
    expect(prompt).toContain("## Goal");
  });

  test("summarizes history and replaces the head with a summary message", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Implement compaction" },
      { role: "assistant", content: "Working on it" },
      { role: "user", content: "Add tests" },
      { role: "assistant", content: "Adding tests now" },
      { role: "user", content: "Ship it" },
    ];

    const provider: ProviderClient = {
      name: "openai",
      generateText() {
        return Promise.resolve("summary");
      },
      generateChat() {
        return Promise.resolve({
          content: "## Goal\n- Implement compaction",
          toolCalls: [],
          assistantMessage: {
            role: "assistant",
            content: "## Goal\n- Implement compaction",
          },
        } satisfies ChatCompletionResult);
      },
      streamChat(_input, handlers) {
        handlers.onChunk("## Goal\n- Implement compaction");
        return this.generateChat(_input);
      },
    };

    const result = await compactHistory({
      history: messages,
      provider,
      systemPrompt: "system",
      compaction,
      force: true,
    });

    expect(result.action).toBe("summarized");
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      summary: true,
      content: "## Goal\n- Implement compaction",
    });
    expect(messages[3]).toEqual({ role: "user", content: "Ship it" });
  });

  test("returns none when history is too short to summarize", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];

    const provider: ProviderClient = {
      name: "openai",
      generateText() {
        return Promise.resolve("summary");
      },
      generateChat() {
        throw new Error("should not summarize");
      },
      streamChat() {
        throw new Error("should not summarize");
      },
    };

    const result = await compactHistory({
      history: messages,
      provider,
      systemPrompt: "system",
      compaction,
      force: true,
    });

    expect(result.action).toBe("none");
    expect(messages).toHaveLength(2);
  });

  test("estimates history tokens from serialized payload", () => {
    const messages: ChatMessage[] = [{ role: "user", content: repeat("x", 400) }];
    const estimate = estimateHistoryTokens(messages, "system prompt");

    expect(estimate).toBeGreaterThan(100);
  });
});
