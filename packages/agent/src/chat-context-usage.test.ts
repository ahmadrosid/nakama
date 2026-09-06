import { describe, expect, test } from "bun:test";
import type { ChatCompletionResult, ProviderClient } from "@nakama/core";
import { createAgentChatSession } from "./index";

const REASONING = "r".repeat(400);

function providerReplayingThinking(
  name: ProviderClient["name"]
): ProviderClient {
  const assistantMessage = {
    content: "Hello",
    role: "assistant" as const,
    thinking: REASONING,
  };

  return {
    async generateChat() {
      return { assistantMessage, content: "Hello", toolCalls: [] };
    },
    async generateText() {
      return { content: "unused" };
    },
    name,
    async streamChat(_input, handlers) {
      handlers.onChunk("Hello");
      return { assistantMessage, content: "Hello", toolCalls: [] };
    },
  };
}

async function usedTokensFor(name: ProviderClient["name"]): Promise<number> {
  const session = createAgentChatSession(
    {
      provider: providerReplayingThinking(name),
    },
    {
      compaction: { contextWindow: 100_000, maxOutputTokens: 8000 },
      enableToolLoop: false,
    }
  );

  // The estimate for a turn is taken before its own reply lands, so the trace
  // only reaches the history the turn after it was produced.
  await session.send("hi");
  await session.send("again");

  return session.getContextUsage()?.usedTokens ?? 0;
}

function usedTokensFromInitialHistory(name: ProviderClient["name"]): number {
  const session = createAgentChatSession(
    {
      provider: providerReplayingThinking(name),
    },
    {
      compaction: { contextWindow: 100_000, maxOutputTokens: 8000 },
      enableToolLoop: false,
      initialHistory: [
        { content: "hi", role: "user" },
        { content: "Hello", role: "assistant", thinking: REASONING },
      ],
    }
  );

  return session.getContextUsage()?.usedTokens ?? 0;
}

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
    const session = createAgentChatSession(
      {
        provider: providerReturning({
          inputTokens: 12_000,
          outputTokens: 40,
          totalTokens: 12_040,
        }),
      },
      {
        compaction: { contextWindow: 100_000, maxOutputTokens: 8000 },
        enableToolLoop: false,
      }
    );

    await session.send("hi");

    expect(session.getContextUsage()).toEqual({
      contextWindow: 100_000,
      source: "provider",
      usableContextTokens: 92_000,
      usedTokens: 12_000,
    });
  });

  test("falls back to an estimate when provider omits usage", async () => {
    const session = createAgentChatSession(
      {
        provider: providerReturning(undefined),
      },
      {
        compaction: { contextWindow: 100_000, maxOutputTokens: 8000 },
        enableToolLoop: false,
      }
    );

    await session.send("hello world");

    const usage = session.getContextUsage();
    expect(usage?.source).toBe("estimate");
    expect(usage?.usedTokens).toBeGreaterThan(0);
    expect(usage?.usableContextTokens).toBe(92_000);
  });

  test("estimates from history before any turn when compaction is configured", () => {
    const session = createAgentChatSession(
      {
        provider: providerReturning(undefined),
      },
      {
        compaction: { contextWindow: 100_000, maxOutputTokens: 20_000 },
        enableToolLoop: false,
        initialHistory: [{ content: "a".repeat(400), role: "user" }],
      }
    );

    const usage = session.getContextUsage();
    expect(usage?.source).toBe("estimate");
    expect(usage?.usableContextTokens).toBe(80_000);
    expect(usage?.usedTokens).toBeGreaterThan(100);
  });

  // toGeminiAssistantParts never sends the trace back, so counting it here
  // would report context the model was never given.
  test("leaves the reasoning trace out of a Gemini estimate", async () => {
    const gemini = await usedTokensFor("gemini");
    const replayer = await usedTokensFor("openai");

    expect({
      differenceIsTheTrace:
        replayer - gemini === Math.ceil(REASONING.length / 4),
      geminiIsSmaller: gemini < replayer,
    }).toEqual({ differenceIsTheTrace: true, geminiIsSmaller: true });
  });

  test("leaves it out of a Gemini estimate taken before any turn", () => {
    const gemini = usedTokensFromInitialHistory("gemini");
    const replayer = usedTokensFromInitialHistory("openai");

    expect({
      differenceIsTheTrace:
        replayer - gemini === Math.ceil(REASONING.length / 4),
      geminiIsSmaller: gemini < replayer,
    }).toEqual({ differenceIsTheTrace: true, geminiIsSmaller: true });
  });
});
