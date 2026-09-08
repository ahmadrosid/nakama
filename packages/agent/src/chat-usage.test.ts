import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  ChatUsage,
  ProviderClient,
  ToolDefinition,
} from "@nakama/core";
import { createAgentChatSession } from "./index";

const toolCall = { arguments: {}, id: "call_1", name: "ping" };

const pingTool: ToolDefinition = {
  description: "Replies pong",
  name: "ping",
  parameters: { properties: {}, type: "object" },
  run: () => Promise.resolve({ pong: true }),
};

const firstUsage: ChatUsage = {
  costUsd: 0.001,
  inputTokens: 100,
  outputTokens: 10,
  totalTokens: 110,
};
const secondUsage: ChatUsage = {
  costUsd: 0.002,
  inputTokens: 200,
  outputTokens: 20,
  totalTokens: 220,
};

function providerWithUsage(): ProviderClient {
  const responses: ChatCompletionResult[] = [
    {
      assistantMessage: {
        content: "",
        role: "assistant",
        toolCalls: [toolCall],
      },
      content: "",
      toolCalls: [toolCall],
      usage: firstUsage,
    },
    {
      assistantMessage: { content: "Done", role: "assistant" },
      content: "Done",
      toolCalls: [],
      usage: secondUsage,
    },
  ];
  const take = () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected provider call");
    }
    return next;
  };

  return {
    generateChat: () => Promise.resolve(take()),
    generateText: () => Promise.resolve({ content: "{}" }),
    name: "openai",
    streamChat: (_input, handlers) => {
      const result = take();
      if (result.content) {
        handlers.onChunk(result.content);
      }
      return Promise.resolve(result);
    },
  };
}

describe("per-call usage", () => {
  test("emits onUsage per LLM call and stores usage on history messages", async () => {
    const session = createAgentChatSession(
      { provider: providerWithUsage(), tools: [pingTool] },
      { enableToolLoop: true }
    );
    const seen: ChatUsage[] = [];

    await session.sendStream("hi", {
      onChunk: () => undefined,
      onUsage: (usage) => seen.push(usage),
    });

    expect(seen).toEqual([firstUsage, secondUsage]);

    const assistantUsages = session
      .getHistory()
      .filter((message) => message.role === "assistant")
      .map((message) =>
        message.role === "assistant" ? message.usage : undefined
      );
    expect(assistantUsages).toEqual([firstUsage, secondUsage]);
  });
});
