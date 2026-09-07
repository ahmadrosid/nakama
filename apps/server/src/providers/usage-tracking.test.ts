import { describe, expect, test } from "bun:test";
import type { ChatCompletionResult, ProviderClient } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { LlmUsageTracker } from "../services/llm-usage-tracker";
import { estimateUsageCostUsd } from "./pricing";
import {
  estimateChatInputBreakdown,
  wrapProviderWithUsageTracking,
} from "./usage-tracking";

function providerReporting(
  usage: NonNullable<ChatCompletionResult["usage"]>
): ProviderClient {
  const result: ChatCompletionResult = {
    assistantMessage: { content: "Hello", role: "assistant" },
    content: "Hello",
    toolCalls: [],
    usage,
  };
  return {
    generateChat: () => Promise.resolve(result),
    generateText: () => Promise.resolve({ content: "unused" }),
    name: "openai",
    streamChat: () => Promise.resolve(result),
  };
}

describe("usage tracking", () => {
  test("attaches the call cost to the result, absent without pricing", async () => {
    const tracker = await LlmUsageTracker.create(
      createInMemoryDatabaseAdapter()
    );
    const usage = { inputTokens: 123, outputTokens: 45, totalTokens: 168 };
    const input = {
      messages: [{ content: "hi", role: "user" as const }],
      system: "system",
    };

    const priced = await wrapProviderWithUsageTracking(
      providerReporting(usage),
      tracker,
      "gpt-4o"
    ).generateChat(input);
    expect(priced.usage?.costUsd).toBeCloseTo(
      estimateUsageCostUsd("gpt-4o", 123, 45),
      12
    );

    tracker.setPricingContext({ provider: "openai_compatible" });
    const unpriced = await wrapProviderWithUsageTracking(
      providerReporting(usage),
      tracker,
      "my-local-model"
    ).generateChat(input);
    expect(unpriced.usage).toEqual(usage);
  });

  test("prefers provider-reported usage for chat calls", async () => {
    const tracker = await LlmUsageTracker.create(
      createInMemoryDatabaseAdapter()
    );
    const provider: ProviderClient = {
      async generateChat() {
        return {
          assistantMessage: { content: "Hello", role: "assistant" },
          content: "Hello",
          toolCalls: [],
          usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168 },
        };
      },
      async generateText() {
        return { content: "unused" };
      },
      name: "openai",
      async streamChat() {
        return {
          assistantMessage: { content: "Hello", role: "assistant" },
          content: "Hello",
          toolCalls: [],
          usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168 },
        };
      },
    };

    const wrapped = wrapProviderWithUsageTracking(provider, tracker, "gpt-4o");
    await wrapped.generateChat({
      messages: [{ content: "hi", role: "user" }],
      system: "system",
    });

    expect(tracker.getStats()).toMatchObject({
      inputTokens: 123,
      outputTokens: 45,
      requestCount: 1,
      totalTokens: 168,
    });
  });

  test("prefers provider-reported usage for text calls", async () => {
    const tracker = await LlmUsageTracker.create(
      createInMemoryDatabaseAdapter()
    );
    const provider: ProviderClient = {
      async generateChat() {
        throw new Error("unused");
      },
      async generateText() {
        return {
          content: "Hello",
          usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
        };
      },
      name: "openai",
      async streamChat() {
        throw new Error("unused");
      },
    };

    const wrapped = wrapProviderWithUsageTracking(provider, tracker, "gpt-4o");
    const result = await wrapped.generateText({
      format: "text",
      prompt: "hi",
      system: "system",
    });

    expect(result).toEqual({
      content: "Hello",
      usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
    });
    expect(tracker.getStats()).toMatchObject({
      inputTokens: 40,
      outputTokens: 10,
      requestCount: 1,
      totalTokens: 50,
    });
  });

  test("stamps estimated usage onto chat results when the provider omits it", async () => {
    const tracker = await LlmUsageTracker.create(
      createInMemoryDatabaseAdapter()
    );
    const provider: ProviderClient = {
      async generateChat() {
        return {
          assistantMessage: { content: "Hello", role: "assistant" },
          content: "Hello",
          toolCalls: [],
        };
      },
      async generateText() {
        return { content: "unused" };
      },
      name: "openai",
      async streamChat() {
        throw new Error("unused");
      },
    };

    const wrapped = wrapProviderWithUsageTracking(provider, tracker, "gpt-4o");
    const result = await wrapped.generateChat({
      messages: [{ content: "hi", role: "user" }],
      system: "system",
    });

    expect(result.usage?.estimated).toBe(true);
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(tracker.getStats().requestCount).toBe(1);
  });

  test("leaves provider usage unmarked as estimated", async () => {
    const tracker = await LlmUsageTracker.create(
      createInMemoryDatabaseAdapter()
    );
    const provider: ProviderClient = {
      async generateChat() {
        return {
          assistantMessage: { content: "Hello", role: "assistant" },
          content: "Hello",
          toolCalls: [],
          usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168 },
        };
      },
      async generateText() {
        return { content: "unused" };
      },
      name: "openai",
      async streamChat() {
        throw new Error("unused");
      },
    };

    const wrapped = wrapProviderWithUsageTracking(provider, tracker, "gpt-4o");
    const result = await wrapped.generateChat({
      messages: [{ content: "hi", role: "user" }],
      system: "system",
    });

    expect(result.usage).toEqual({
      costUsd: estimateUsageCostUsd("gpt-4o", 123, 45),
      inputTokens: 123,
      outputTokens: 45,
      totalTokens: 168,
    });
  });

  test("estimateChatInputBreakdown splits system, tools, and messages", () => {
    const system = ["You are helpful.", "", "# Identity", "a".repeat(40)].join(
      "\n"
    );
    const tools = [
      {
        description: "b".repeat(80),
        name: "heavy",
        parameters: { properties: { q: { type: "string" } }, type: "object" },
      },
      {
        description: "tiny",
        name: "light",
        parameters: { properties: {}, type: "object" },
      },
    ];
    const toolsChars = JSON.stringify(tools).length;

    const breakdown = estimateChatInputBreakdown({
      messages: [
        { content: "c".repeat(8), role: "user" }, // 2 tokens
        {
          content: "ok",
          role: "assistant",
          toolCalls: [{ arguments: "{}", id: "1", name: "demo" }],
        },
        { content: "done", name: "demo", role: "tool", toolCallId: "1" },
      ],
      system,
      tools,
    });

    expect(breakdown.systemTokens).toBe(Math.ceil(system.length / 4));
    expect(breakdown.systemSections[0]?.title).toBe("Identity");
    expect(breakdown.toolsCount).toBe(2);
    expect(breakdown.toolsChars).toBe(toolsChars);
    expect(breakdown.toolsTokens).toBe(Math.ceil(toolsChars / 4));
    expect(breakdown.toolsBySize.map((tool) => tool.name)).toEqual([
      "heavy",
      "light",
    ]);
    expect(breakdown.toolsBySize[0]?.descriptionChars).toBe(80);
    expect(breakdown.messageCount).toBe(3);
    expect(breakdown.messagesByRole).toEqual({
      assistant: 1,
      other: 0,
      tool: 1,
      user: 1,
    });
    expect(breakdown.totalEstimatedInputTokens).toBe(
      breakdown.systemTokens + breakdown.toolsTokens + breakdown.messagesTokens
    );
  });
});
