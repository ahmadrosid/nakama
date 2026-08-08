import { describe, expect, test } from "bun:test";
import type { ChatCompletionResult, ProviderClient } from "@nakama/core";
import { createAgentHarness } from "./index";

function providerReturning(
  usage?: ChatCompletionResult["usage"]
): ProviderClient {
  return {
    async generateChat() {
      return {
        assistantMessage: { content: "Hello", role: "assistant" },
        content: "Hello",
        toolCalls: [],
        usage,
      };
    },
    async generateText() {
      return { content: "unused" };
    },
    name: "openai",
    async streamChat(_input, handlers) {
      handlers.onChunk("Hello");
      return {
        assistantMessage: { content: "Hello", role: "assistant" },
        content: "Hello",
        toolCalls: [],
        usage,
      };
    },
  };
}

describe("chat context usage", () => {
  test("tracks provider usage against usable context", async () => {
    const harness = createAgentHarness({
      provider: providerReturning({
        inputTokens: 12_000,
        outputTokens: 40,
        totalTokens: 12_040,
      }),
    });
    const session = harness.createChatSession({
      compaction: { contextWindow: 100_000, maxOutputTokens: 8000 },
      enableToolLoop: false,
    });

    await session.send("hi");

    expect(session.getContextUsage()).toEqual({
      contextWindow: 100_000,
      source: "provider",
      usableContextTokens: 92_000,
      usedTokens: 12_000,
    });
  });

  test("falls back to an estimate when provider omits usage", async () => {
    const harness = createAgentHarness({
      provider: providerReturning(undefined),
    });
    const session = harness.createChatSession({
      compaction: { contextWindow: 100_000, maxOutputTokens: 8000 },
      enableToolLoop: false,
    });

    await session.send("hello world");

    const usage = session.getContextUsage();
    expect(usage?.source).toBe("estimate");
    expect(usage?.usedTokens).toBeGreaterThan(0);
    expect(usage?.usableContextTokens).toBe(92_000);
  });

  test("estimates from history before any turn when compaction is configured", () => {
    const harness = createAgentHarness({
      provider: providerReturning(undefined),
    });
    const session = harness.createChatSession({
      compaction: { contextWindow: 100_000, maxOutputTokens: 20_000 },
      enableToolLoop: false,
      initialHistory: [{ content: "a".repeat(400), role: "user" }],
    });

    const usage = session.getContextUsage();
    expect(usage?.source).toBe("estimate");
    expect(usage?.usableContextTokens).toBe(80_000);
    expect(usage?.usedTokens).toBeGreaterThan(100);
  });
});
