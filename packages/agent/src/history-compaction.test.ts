import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  ChatMessage,
  ProviderClient,
} from "@nakama/core";
import {
  buildCompactionPrompt,
  type CompactionConfig,
  compactHistory,
  estimateHistoryTokenBreakdown,
  estimateHistoryTokens,
  isOverflow,
  pruneToolOutputs,
  selectCompactionRange,
  usableContextTokens,
} from "./history-compaction";

const compaction: CompactionConfig = {
  contextWindow: 100_000,
  maxOutputTokens: 8192,
};

const largeWindow: CompactionConfig = {
  contextWindow: 1_000_000,
  maxOutputTokens: 8192,
};

const smallWindow: CompactionConfig = {
  contextWindow: 128_000,
  maxOutputTokens: 8192,
};

function createToolMessage(content: string): ChatMessage {
  return {
    content,
    name: "read",
    role: "tool",
    toolCallId: "call_1",
  };
}

// Builds the 14-message transcript used by the prune tests: three turns
// each carrying one tool result, followed by a tail turn with no tool call.
// The last two user turns are protected, so only the older tool messages
// are pruning candidates.
function seedHistory(toolChars: number): ChatMessage[] {
  return [
    { content: "turn 1", role: "user" },
    createToolMessage("a".repeat(toolChars)),
    { content: "done 1", role: "assistant" },
    { content: "turn 2", role: "user" },
    createToolMessage("b".repeat(toolChars)),
    { content: "done 2", role: "assistant" },
    { content: "turn 3", role: "user" },
    createToolMessage("c".repeat(toolChars)),
    { content: "done 3", role: "assistant" },
    { content: "turn 4", role: "user" },
    { content: "done 4", role: "assistant" },
  ];
}

describe("history compaction", () => {
  test("detects overflow against reserved context budget", () => {
    const usable = usableContextTokens(compaction);

    expect(isOverflow(usable - 1, compaction)).toBe(false);
    expect(isOverflow(usable, compaction)).toBe(true);
  });

  test("does not prune when tool output is well below the model's usable window (#342)", () => {
    // Three 30k-token tool results; the last 2 turns are protected, so two
    // candidates (60k tokens) are considered. On a 1M window the protect
    // fraction is ~496k, so the loop must leave the stored transcript intact.
    const messages = seedHistory(120_000);
    const result = pruneToolOutputs(messages, largeWindow);

    expect(result.prunedTokens).toBe(0);
    expect(messages[1]?.role === "tool" && messages[1].content).toBe(
      "a".repeat(120_000)
    );
    expect(messages[4]?.role === "tool" && messages[4].content).toBe(
      "b".repeat(120_000)
    );
    expect(messages[7]?.role === "tool" && messages[7].content).toBe(
      "c".repeat(120_000)
    );
  });

  test("still prunes when accumulated tool output crosses the protect fraction", () => {
    // Same three 30k-token tool results against a 128k window. The protect
    // fraction is ~60k, so the older candidate crosses the threshold and the
    // function must truncate it.
    const messages = seedHistory(120_000);
    const result = pruneToolOutputs(messages, smallWindow);

    expect(result.prunedTokens).toBeGreaterThan(0);
    expect(messages[1]?.role === "tool" && messages[1].content).toContain(
      "truncated"
    );
    expect(messages[4]?.role === "tool" && messages[4].content).toBe(
      "b".repeat(120_000)
    );
  });

  test("does not truncate when reclaimed tokens do not clear the minimum fraction", () => {
    // usable = 200k (protect = 100k, minimum = 20k). Walking newest→oldest,
    // the 95k-token result stays under protect and the 20k-token one crosses
    // it, but the reclaim equals the minimum, so nothing may be rewritten.
    const messages: ChatMessage[] = [
      { content: "turn 1", role: "user" },
      createToolMessage("a".repeat(80_000)),
      { content: "done 1", role: "assistant" },
      { content: "turn 2", role: "user" },
      createToolMessage("b".repeat(380_000)),
      { content: "done 2", role: "assistant" },
      { content: "turn 3", role: "user" },
      createToolMessage("c".repeat(4000)),
      { content: "done 3", role: "assistant" },
      { content: "turn 4", role: "user" },
      { content: "done 4", role: "assistant" },
    ];
    const window: CompactionConfig = {
      contextWindow: 208_192,
      maxOutputTokens: 8192,
    };

    const result = pruneToolOutputs(messages, window);

    expect(result.prunedTokens).toBe(0);
    expect(messages[1]?.role === "tool" && messages[1].content).toBe(
      "a".repeat(80_000)
    );
    expect(messages[4]?.role === "tool" && messages[4].content).toBe(
      "b".repeat(380_000)
    );
  });

  test("does not prune when usable tokens are non-positive", () => {
    const degenerate: CompactionConfig = {
      contextWindow: 4096,
      maxOutputTokens: 8192,
    };

    const messages = seedHistory(200_000);
    const result = pruneToolOutputs(messages, degenerate);

    expect(result.prunedTokens).toBe(0);
    expect(messages[1]?.role === "tool" && messages[1].content).toBe(
      "a".repeat(200_000)
    );
  });

  test("does not mutate shared tool message objects in place (#589)", () => {
    const original = createToolMessage("a".repeat(200_000));
    const messages: ChatMessage[] = [
      { content: "turn 1", role: "user" },
      original,
      { content: "done 1", role: "assistant" },
      { content: "turn 2", role: "user" },
      createToolMessage("b".repeat(10_000)),
      { content: "done 2", role: "assistant" },
      { content: "turn 3", role: "user" },
      createToolMessage("c".repeat(10_000)),
      { content: "done 3", role: "assistant" },
      { content: "turn 4", role: "user" },
      { content: "done 4", role: "assistant" },
    ];

    const result = pruneToolOutputs(messages, compaction);

    expect(result.prunedTokens).toBeGreaterThan(0);
    expect(original.content).toBe("a".repeat(200_000));
    expect(messages[1]).not.toBe(original);
    expect(messages[1]?.role === "tool" && messages[1].content).toContain(
      "truncated"
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
      { content: "x".repeat(400), role: "user" },
    ];
    const estimate = estimateHistoryTokens(messages, "system prompt");

    expect(estimate).toBeGreaterThan(100);
  });

  test("splits the estimate into system, tools, and conversation", () => {
    const messages: ChatMessage[] = [
      { content: "x".repeat(400), role: "user" },
    ];
    const tools = [
      {
        description: "search",
        name: "search",
        parameters: { type: "object" },
      },
    ];
    const breakdown = estimateHistoryTokenBreakdown(
      messages,
      "system prompt",
      tools
    );

    expect(breakdown.systemPrompt).toBeGreaterThan(0);
    expect(breakdown.conversation).toBeGreaterThan(0);
    expect(breakdown.toolDefinitions).toBeGreaterThan(0);
    expect(
      breakdown.systemPrompt +
        breakdown.conversation +
        breakdown.toolDefinitions
    ).toBe(estimateHistoryTokens(messages, "system prompt", tools));
  });

  test("counts providerContent once and keeps thinking (#340)", () => {
    const thinking = "t".repeat(800);
    const text = "Let me look that up.";
    const toolCalls = [
      {
        arguments: { query: "invoice" },
        id: "call_1",
        name: "search_invoices",
      },
    ];
    const providerContent = [
      { thinking, type: "thinking" },
      { text, type: "text" },
      {
        id: "call_1",
        input: { query: "invoice" },
        name: "search_invoices",
        type: "tool_use",
      },
    ];
    const withProvider: ChatMessage[] = [
      {
        content: text,
        providerContent,
        role: "assistant",
        toolCalls,
      },
    ];
    const withoutProvider: ChatMessage[] = [
      {
        content: text,
        role: "assistant",
        toolCalls,
      },
    ];
    const empty: ChatMessage[] = [];

    const withEstimate =
      estimateHistoryTokens(withProvider, "") -
      estimateHistoryTokens(empty, "");
    const withoutEstimate =
      estimateHistoryTokens(withoutProvider, "") -
      estimateHistoryTokens(empty, "");
    const providerOnly = Math.ceil(JSON.stringify(providerContent).length / 4);
    const contentAndTools =
      Math.ceil(text.length / 4) +
      Math.ceil(JSON.stringify(toolCalls).length / 4);

    expect(withEstimate).toBe(providerOnly);
    expect(withEstimate).toBeGreaterThan(withoutEstimate);
    expect(withoutEstimate).toBe(contentAndTools);
  });
});
