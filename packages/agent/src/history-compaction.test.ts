import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  ChatMessage,
  ProviderClient,
} from "@nakama/core";
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
  maxOutputTokens: 8192,
};

function repeat(char: string, count: number): string {
  return char.repeat(count);
}

function createToolMessage(content: string): ChatMessage {
  return {
    content,
    name: "read",
    role: "tool",
    toolCallId: "call_1",
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
      { content: "turn 1", role: "user" },
      createToolMessage(repeat("a", 200_000)),
      { content: "done 1", role: "assistant" },
      { content: "turn 2", role: "user" },
      createToolMessage(repeat("b", 10_000)),
      { content: "done 2", role: "assistant" },
      { content: "turn 3", role: "user" },
      createToolMessage(repeat("c", 10_000)),
      { content: "done 3", role: "assistant" },
      { content: "turn 4", role: "user" },
      { content: "done 4", role: "assistant" },
    ];

    const result = pruneToolOutputs(messages);

    expect(result.prunedTokens).toBeGreaterThan(0);
    expect(messages[1]?.role === "tool" && messages[1].content).toContain(
      "truncated"
    );
    expect(messages[10]?.role === "assistant" && messages[10].content).toBe(
      "done 4"
    );
  });

  test("selects only the head for summarization", () => {
    const messages: ChatMessage[] = [
      { content: "one", role: "user" },
      { content: "a1", role: "assistant" },
      { content: "two", role: "user" },
      { content: "a2", role: "assistant" },
      { content: "three", role: "user" },
      { content: "a3", role: "assistant" },
    ];

    const selected = selectCompactionRange(messages);

    expect(selected.tailStartIndex).toBe(2);
    expect(selected.head).toEqual([
      { content: "one", role: "user" },
      { content: "a1", role: "assistant" },
    ]);
  });

  test("builds anchored compaction prompts from previous summaries", () => {
    const prompt = buildCompactionPrompt("Previous task summary");

    expect(prompt).toContain("<previous-summary>");
    expect(prompt).toContain("## Goal");
  });

  test("summarizes history and replaces the head with a summary message", async () => {
    const messages: ChatMessage[] = [
      { content: "Implement compaction", role: "user" },
      { content: "Working on it", role: "assistant" },
      { content: "Add tests", role: "user" },
      { content: "Adding tests now", role: "assistant" },
      { content: "Ship it", role: "user" },
    ];

    const provider: ProviderClient = {
      generateChat() {
        return Promise.resolve({
          assistantMessage: {
            content: "## Goal\n- Implement compaction",
            role: "assistant",
          },
          content: "## Goal\n- Implement compaction",
          toolCalls: [],
        } satisfies ChatCompletionResult);
      },
      generateText() {
        return Promise.resolve({ content: "summary" });
      },
      name: "openai",
      streamChat(_input, handlers) {
        handlers.onChunk("## Goal\n- Implement compaction");
        return this.generateChat(_input);
      },
    };

    const result = await compactHistory({
      compaction,
      force: true,
      history: messages,
      provider,
      systemPrompt: "system",
    });

    expect(result.action).toBe("summarized");
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({
      content: "## Goal\n- Implement compaction",
      role: "assistant",
      summary: true,
    });
    expect(messages[3]).toEqual({ content: "Ship it", role: "user" });
  });

  test("returns none when history is too short to summarize", async () => {
    const messages: ChatMessage[] = [
      { content: "hello", role: "user" },
      { content: "hi", role: "assistant" },
    ];

    const provider: ProviderClient = {
      generateChat() {
        throw new Error("should not summarize");
      },
      generateText() {
        return Promise.resolve({ content: "summary" });
      },
      name: "openai",
      streamChat() {
        throw new Error("should not summarize");
      },
    };

    const result = await compactHistory({
      compaction,
      force: true,
      history: messages,
      provider,
      systemPrompt: "system",
    });

    expect(result.action).toBe("none");
    expect(messages).toHaveLength(2);
  });

  test("estimates history tokens from serialized payload", () => {
    const messages: ChatMessage[] = [
      { content: repeat("x", 400), role: "user" },
    ];
    const estimate = estimateHistoryTokens(messages, "system prompt");

    expect(estimate).toBeGreaterThan(100);
  });
});
