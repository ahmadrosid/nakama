import { describe, expect, test } from "bun:test";
import type { ChatCompletionResult, GenerateChatInput, ProviderClient } from "@nakama/core";
import { createAgentHarness } from "./index";

function createCapturingProvider(
  response: ChatCompletionResult,
): ProviderClient & { lastInput?: GenerateChatInput } {
  const provider: ProviderClient & { lastInput?: GenerateChatInput } = {
    name: "anthropic",
    generateText() {
      return Promise.resolve({ content: "{}" });
    },
    generateChat(input) {
      provider.lastInput = input;
      return Promise.resolve(response);
    },
    streamChat(input, handlers) {
      provider.lastInput = input;
      handlers.onThinking?.("trace ");
      handlers.onChunk(response.content);
      return Promise.resolve(response);
    },
  };

  return provider;
}

describe("thinking provider options", () => {
  test("merges thinking with web search options", async () => {
    const provider = createCapturingProvider({
      content: "Answer",
      toolCalls: [],
      assistantMessage: { role: "assistant", content: "Answer" },
    });

    const harness = createAgentHarness({
      provider,
      chatOptions: { thinking: { enabled: true, effort: "high" } },
    });
    const session = harness.createChatSession({
      enableToolLoop: false,
    });

    const events: string[] = [];
    await session.sendStream("hello", {
      onChunk: (delta) => events.push(`chunk:${delta}`),
      onThinking: (delta) => events.push(`thinking:${delta}`),
    });

    expect(provider.lastInput?.providerOptions).toEqual({
      thinking: { enabled: true, effort: "high" },
    });
    expect(events).toEqual(["thinking:trace ", "chunk:Answer"]);
  });

  test("disables thinking for multimodal turns", async () => {
    const provider = createCapturingProvider({
      content: "Seen",
      toolCalls: [],
      assistantMessage: { role: "assistant", content: "Seen" },
    });

    const harness = createAgentHarness({
      provider,
      chatOptions: { thinking: { enabled: true, effort: "medium" } },
    });
    const session = harness.createChatSession({ enableToolLoop: false });

    await session.send({
      message: "describe",
      images: [{ mediaType: "image/png", data: "aGVsbG8=" }],
    });

    expect(provider.lastInput?.providerOptions).toBeUndefined();
  });
});
