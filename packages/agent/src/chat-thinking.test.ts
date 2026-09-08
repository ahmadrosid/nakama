import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  GenerateChatInput,
  ProviderClient,
} from "@nakama/core";
import { createAgentChatSession } from "./index";

function createCapturingProvider(
  response: ChatCompletionResult,
  options: {
    name?: ProviderClient["name"];
    thinking?: string;
  } = {}
): ProviderClient & { lastInput?: GenerateChatInput } {
  const provider: ProviderClient & { lastInput?: GenerateChatInput } = {
    generateChat(input) {
      provider.lastInput = input;
      return Promise.resolve(response);
    },
    generateText() {
      return Promise.resolve({ content: "{}" });
    },
    name: options.name ?? "anthropic",
    streamChat(input, handlers) {
      provider.lastInput = input;
      if (options.thinking) {
        handlers.onThinking?.(options.thinking);
      }
      if (response.content) {
        handlers.onChunk(response.content);
      }
      return Promise.resolve(response);
    },
  };

  return provider;
}

const textReply = (content: string): ChatCompletionResult => ({
  assistantMessage: { content, role: "assistant" },
  content,
  toolCalls: [],
});

describe("thinking provider options", () => {
  test("merges thinking with web search options", async () => {
    const provider = createCapturingProvider(textReply("Answer"), {
      thinking: "trace ",
    });

    const session = createAgentChatSession(
      {
        chatOptions: { thinking: { effort: "high", enabled: true } },
        provider,
      },
      {
        enableToolLoop: false,
      }
    );

    const events: string[] = [];
    await session.sendStream("hello", {
      onChunk: (delta) => events.push(`chunk:${delta}`),
      onThinking: (delta) => events.push(`thinking:${delta}`),
    });

    expect(provider.lastInput?.providerOptions).toEqual({
      thinking: { effort: "high", enabled: true },
    });
    expect(events).toEqual(["thinking:trace ", "chunk:Answer"]);
  });

  test("disables thinking for multimodal turns", async () => {
    const provider = createCapturingProvider(textReply("Seen"));

    const session = createAgentChatSession(
      {
        chatOptions: { thinking: { effort: "medium", enabled: true } },
        provider,
      },
      { enableToolLoop: false }
    );

    await session.send({
      images: [{ data: "aGVsbG8=", mediaType: "image/png" }],
      message: "describe",
    });

    expect(provider.lastInput?.providerOptions).toBeUndefined();
  });
});
