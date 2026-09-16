import { describe, expect, spyOn, test } from "bun:test";
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
  test.each(["tool", "arguments", "completion"])(
    "records thinking that ends with %s instead of an answer",
    async (ending) => {
      let now = 1000;
      const clock = spyOn(Date, "now").mockImplementation(() => now);
      try {
        const provider = createCapturingProvider(textReply(""));
        provider.streamChat = (_input, handlers) => {
          handlers.onThinking?.("Reasoning");
          now = 5000;
          handlers.onThinking?.(" continues");
          handlers.onChunk("");
          now = 9000;
          if (ending === "tool") {
            handlers.onToolStart?.({
              input: {},
              tool: "search",
              toolCallId: "t1",
            });
            now = 30_000;
          } else if (ending === "arguments") {
            handlers.onToolInputDelta?.({
              delta: "{}",
              tool: "search",
              toolCallId: "t1",
            });
            now = 30_000;
          }
          return Promise.resolve(textReply(""));
        };
        const session = createAgentChatSession(
          { provider },
          { enableToolLoop: false }
        );
        await session.sendStream("hello", { onChunk() {} });
        expect(session.getHistory().at(-1)).toMatchObject({
          thinkingDurationMs: 8000,
        });
      } finally {
        clock.mockRestore();
      }
    }
  );

  test("retains reasoning duration in history without counting answer generation", async () => {
    let now = 1000;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      const provider = createCapturingProvider(textReply("Answer"));
      provider.streamChat = (_input, handlers) => {
        now = 3000;
        handlers.onThinking?.("Let me think");
        now = 11_000;
        handlers.onChunk("Answer");
        now = 31_000;
        return Promise.resolve({
          ...textReply("Answer"),
          assistantMessage: {
            content: "Answer",
            role: "assistant",
            thinking: "Let me think",
          },
        });
      };
      const session = createAgentChatSession(
        { provider },
        { enableToolLoop: false }
      );
      await session.sendStream("hello", { onChunk() {} });
      expect(
        JSON.parse(JSON.stringify(session.getHistory())).at(-1)
      ).toMatchObject({
        thinking: "Let me think",
        thinkingDurationMs: 8000,
      });
    } finally {
      clock.mockRestore();
    }
  });

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
