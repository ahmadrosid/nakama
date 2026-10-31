import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  GenerateChatInput,
  ProviderClient,
} from "@nakama/core";
import { NakamaApiError, ProviderStreamInterruptedError } from "@nakama/core";
import { createAgentChatSession } from "./index";

function createFlakyProvider(failures: Error[], replies: string[]) {
  let callIndex = 0;
  let replyIndex = 0;

  const respond = (): ChatCompletionResult => {
    const failure = failures[callIndex];

    if (failure) {
      callIndex += 1;
      throw failure;
    }

    const content = replies[replyIndex] ?? "Unexpected extra reply";
    replyIndex += 1;
    callIndex += 1;

    return {
      assistantMessage: { content, role: "assistant" },
      content,
      toolCalls: [],
    };
  };

  return {
    getCallCount: () => callIndex,
    provider: {
      generateChat(_input: GenerateChatInput) {
        return Promise.resolve(respond());
      },
      generateText() {
        return Promise.resolve({ content: "{}" });
      },
      name: "openai",
      streamChat(_input: GenerateChatInput, handlers) {
        const result = respond();

        if (result.content) {
          handlers.onChunk(result.content);
        }

        return Promise.resolve(result);
      },
    } satisfies ProviderClient,
  };
}

describe("agent chat provider retry", () => {
  test("retries a transient provider HTTP failure once and the turn succeeds", async () => {
    const { provider, getCallCount } = createFlakyProvider(
      [
        new NakamaApiError(
          "OpenAI request failed (429): rate limit exceeded",
          502
        ),
      ],
      ["Recovered"]
    );

    const session = createAgentChatSession({ provider });
    let reply = "";

    await session.sendStream("Hello", {
      onChunk(chunk) {
        reply += chunk;
      },
    });

    expect(reply).toBe("Recovered");
    expect(getCallCount()).toBe(2);
    expect(session.getHistory()).toEqual([
      { content: "Hello", role: "user" },
      { content: "Recovered", role: "assistant" },
    ]);
  });

  test("fails the turn when the provider fails again after the retry", async () => {
    const { provider, getCallCount } = createFlakyProvider(
      [
        new NakamaApiError("OpenAI request failed (503): unavailable", 502),
        new NakamaApiError("OpenAI request failed (503): unavailable", 502),
      ],
      []
    );

    const session = createAgentChatSession({ provider });

    await expect(
      session.sendStream("Hello", { onChunk() {} })
    ).rejects.toBeInstanceOf(NakamaApiError);
    expect(getCallCount()).toBe(2);
  });

  test("does not retry client-status provider errors", async () => {
    const { provider, getCallCount } = createFlakyProvider(
      [new NakamaApiError("OpenAI request failed (400): bad request", 400)],
      []
    );

    const session = createAgentChatSession({ provider });

    await expect(
      session.sendStream("Hello", { onChunk() {} })
    ).rejects.toBeInstanceOf(NakamaApiError);
    expect(getCallCount()).toBe(1);
  });

  test("does not retry a second mid-stream interruption", async () => {
    const { provider, getCallCount } = createFlakyProvider(
      [
        new ProviderStreamInterruptedError("stream closed mid-reply"),
        new ProviderStreamInterruptedError("stream closed mid-reply"),
      ],
      []
    );

    const session = createAgentChatSession({ provider });

    await expect(
      session.sendStream("Hello", { onChunk() {} })
    ).rejects.toBeInstanceOf(ProviderStreamInterruptedError);
    expect(getCallCount()).toBe(2);
  });
});
