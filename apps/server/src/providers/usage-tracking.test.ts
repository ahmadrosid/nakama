import { describe, expect, test } from "bun:test";
import type { ProviderClient } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { LlmUsageTracker } from "../services/llm-usage-tracker";
import {
  estimateChatInputBreakdown,
  wrapProviderWithUsageTracking,
} from "./usage-tracking";

describe("usage tracking", () => {
  test("prefers provider-reported usage for chat calls", async () => {
    const tracker = await LlmUsageTracker.create(createInMemoryDatabaseAdapter());
    const provider: ProviderClient = {
      name: "openai",
      async generateText() {
        return { content: "unused" };
      },
      async generateChat() {
        return {
          content: "Hello",
          toolCalls: [],
          assistantMessage: { role: "assistant", content: "Hello" },
          usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168 },
        };
      },
      async streamChat() {
        return {
          content: "Hello",
          toolCalls: [],
          assistantMessage: { role: "assistant", content: "Hello" },
          usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168 },
        };
      },
    };

    const wrapped = wrapProviderWithUsageTracking(provider, tracker, "gpt-4o");
    await wrapped.generateChat({
      system: "system",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(tracker.getStats()).toMatchObject({
      requestCount: 1,
      inputTokens: 123,
      outputTokens: 45,
      totalTokens: 168,
    });
  });

  test("prefers provider-reported usage for text calls", async () => {
    const tracker = await LlmUsageTracker.create(createInMemoryDatabaseAdapter());
    const provider: ProviderClient = {
      name: "openai",
      async generateText() {
        return {
          content: "Hello",
          usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
        };
      },
      async generateChat() {
        throw new Error("unused");
      },
      async streamChat() {
        throw new Error("unused");
      },
    };

    const wrapped = wrapProviderWithUsageTracking(provider, tracker, "gpt-4o");
    const result = await wrapped.generateText({
      system: "system",
      prompt: "hi",
      format: "text",
    });

    expect(result).toEqual({
      content: "Hello",
      usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
    });
    expect(tracker.getStats()).toMatchObject({
      requestCount: 1,
      inputTokens: 40,
      outputTokens: 10,
      totalTokens: 50,
    });
  });

  test("estimateChatInputBreakdown splits system, tools, and messages", () => {
    const system = ["You are helpful.", "", "# Identity", "a".repeat(40)].join("\n");
    const tools = [
      {
        name: "heavy",
        description: "b".repeat(80),
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
      {
        name: "light",
        description: "tiny",
        parameters: { type: "object", properties: {} },
      },
    ];
    const toolsChars = JSON.stringify(tools).length;

    const breakdown = estimateChatInputBreakdown({
      system,
      messages: [
        { role: "user", content: "c".repeat(8) }, // 2 tokens
        { role: "assistant", content: "ok", toolCalls: [{ id: "1", name: "demo", arguments: "{}" }] },
        { role: "tool", toolCallId: "1", name: "demo", content: "done" },
      ],
      tools,
    });

    expect(breakdown.systemTokens).toBe(Math.ceil(system.length / 4));
    expect(breakdown.systemSections[0]?.title).toBe("Identity");
    expect(breakdown.toolsCount).toBe(2);
    expect(breakdown.toolsChars).toBe(toolsChars);
    expect(breakdown.toolsTokens).toBe(Math.ceil(toolsChars / 4));
    expect(breakdown.toolsBySize.map((tool) => tool.name)).toEqual(["heavy", "light"]);
    expect(breakdown.toolsBySize[0]?.descriptionChars).toBe(80);
    expect(breakdown.messageCount).toBe(3);
    expect(breakdown.messagesByRole).toEqual({
      user: 1,
      assistant: 1,
      tool: 1,
      other: 0,
    });
    expect(breakdown.totalEstimatedInputTokens).toBe(
      breakdown.systemTokens + breakdown.toolsTokens + breakdown.messagesTokens,
    );
  });
});
