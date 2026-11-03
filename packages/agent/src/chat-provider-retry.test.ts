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
      [new NakamaApiError("OpenAI request failed (401): invalid api key", 400)],
      []
    );

    const session = createAgentChatSession({ provider });

    await expect(
      session.sendStream("Hello", { onChunk() {} })
    ).rejects.toBeInstanceOf(NakamaApiError);
    expect(getCallCount()).toBe(1);
  });

  test("retries a connection failure once and the turn succeeds", async () => {
    const { provider, getCallCount } = createFlakyProvider(
      [
        new TypeError(
          "Unable to connect. Is the computer able to access the url?"
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
  });

  test("fails the turn after a second connection failure", async () => {
    const { provider, getCallCount } = createFlakyProvider(
      [
        new TypeError(
          "Unable to connect. Is the computer able to access the url?"
        ),
        new TypeError(
          "Unable to connect. Is the computer able to access the url?"
        ),
      ],
      []
    );

    const session = createAgentChatSession({ provider });

    await expect(
      session.sendStream("Hello", { onChunk() {} })
    ).rejects.toBeInstanceOf(TypeError);
    expect(getCallCount()).toBe(2);
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

  test("retries a connection reset named by code once and succeeds", async () => {
    const reset = () =>
      Object.assign(new TypeError("socket hang up"), {
        code: "ECONNRESET",
      });

    const { provider, getCallCount } = createFlakyProvider(
      [reset()],
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
  });

  test("keeps the partial reply when a reset lands mid-stream", async () => {
    let callIndex = 0;

    const provider: ProviderClient = {
      generateChat() {
        throw new Error("streamChat only in this test");
      },
      generateText() {
        return Promise.resolve({ content: "{}" });
      },
      name: "openai",
      streamChat(_input: GenerateChatInput, handlers) {
        callIndex += 1;

        if (callIndex === 1) {
          handlers.onChunk("Partial");
          throw Object.assign(new TypeError("socket hang up"), {
            code: "ECONNRESET",
          });
        }

        handlers.onChunk(" world");

        return Promise.resolve({
          assistantMessage: { content: " world", role: "assistant" },
          content: " world",
          toolCalls: [],
        });
      },
    };

    const session = createAgentChatSession({ provider });
    let reply = "";

    await session.sendStream("Hello", {
      onChunk(chunk) {
        reply += chunk;
      },
    });

    expect(reply).toBe("Partial world");
    expect(callIndex).toBe(2);
    expect(session.getHistory()).toEqual([
      { content: "Hello", role: "user" },
      { content: "Partial", role: "assistant" },
      { content: " world", role: "assistant" },
    ]);
  });

  test("closes the open tool step when a reset lands after its input", async () => {
    let callIndex = 0;

    const toolCall = {
      arguments: { message: "hi" },
      id: "call_1",
      name: "slow",
    };

    const ended: Array<{ result: { error?: string }; toolCallId: string }> = [];

    const provider: ProviderClient = {
      generateChat() {
        throw new Error("streamChat only in this test");
      },
      generateText() {
        return Promise.resolve({ content: "{}" });
      },
      name: "openai",
      streamChat(_input: GenerateChatInput, handlers) {
        callIndex += 1;

        if (callIndex === 1) {
          handlers.onToolInputDelta({ tool: toolCall, toolCallId: "call_1" });
          throw Object.assign(new TypeError("socket hang up"), {
            code: "ECONNRESET",
          });
        }

        handlers.onChunk("Done");

        return Promise.resolve({
          assistantMessage: { content: "Done", role: "assistant" },
          content: "Done",
          toolCalls: [],
        });
      },
    };

    const session = createAgentChatSession({ provider });
    let reply = "";

    await session.sendStream("Hello", {
      onChunk(chunk) {
        reply += chunk;
      },
      onToolEnd(event) {
        ended.push({ result: event.result, toolCallId: event.toolCallId });
      },
    });

    expect(reply).toBe("Done");
    expect(callIndex).toBe(2);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.toolCallId).toBe("call_1");
    expect(ended[0]?.result).toMatchObject({ error: expect.any(String) });
    expect(session.getHistory()).toEqual([
      { content: "Hello", role: "user" },
      { content: "Done", role: "assistant" },
    ]);
  });
});
