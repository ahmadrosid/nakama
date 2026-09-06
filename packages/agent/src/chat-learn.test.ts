import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  GenerateChatInput,
  ProviderClient,
} from "@nakama/core";
import { createAgentChatSession } from "./index";
import { expandLearnInLastUserMessage } from "./learn-prompt";

function createCapturingProvider(
  response: ChatCompletionResult
): ProviderClient & { lastInput?: GenerateChatInput } {
  const provider: ProviderClient & { lastInput?: GenerateChatInput } = {
    generateChat(input) {
      provider.lastInput = input;
      return Promise.resolve(response);
    },
    generateText() {
      return Promise.resolve({ content: "{}" });
    },
    name: "anthropic",
    streamChat(input, handlers) {
      provider.lastInput = input;
      if (response.content) {
        handlers.onChunk(response.content);
      }
      return Promise.resolve(response);
    },
  };

  return provider;
}

describe("/learn provider expansion", () => {
  test("sends expanded /learn to the provider while history stays raw", async () => {
    const provider = createCapturingProvider({
      assistantMessage: { content: "Saved.", role: "assistant" },
      content: "Saved.",
      toolCalls: [],
    });

    const session = createAgentChatSession(
      { provider },
      {
        rehydrateMessagesForProvider: (messages) =>
          Promise.resolve(expandLearnInLastUserMessage([...messages])),
      }
    );

    const typed = "/learn filing an expense";
    await session.send(typed);

    expect(session.getHistory().at(0)?.content).toBe(typed);

    const providerUser = provider.lastInput?.messages.find(
      (message) => message.role === "user"
    );
    expect(typeof providerUser?.content).toBe("string");
    expect(providerUser?.content).toContain("[/learn]");
    expect(providerUser?.content).toContain("filing an expense");
    expect(providerUser?.content).not.toBe(typed);
  });
});
