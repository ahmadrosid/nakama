import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  GenerateChatInput,
  ProviderClient,
  ToolCall,
  ToolContext,
  ToolDefinition,
} from "@nakama/core";
import { ProviderStreamInterruptedError } from "@nakama/core";
import { createAgentChatSession } from "./index";

function createCountingProvider(responses: ChatCompletionResult[]) {
  let callIndex = 0;

  const take = (): ChatCompletionResult => {
    const response = responses[callIndex];
    callIndex += 1;

    if (!response) {
      throw new Error(`Unexpected provider call ${callIndex}`);
    }

    return response;
  };

  return {
    getCallCount: () => callIndex,
    provider: {
      generateChat(_input: GenerateChatInput) {
        return Promise.resolve(take());
      },
      generateText() {
        return Promise.resolve({ content: "{}" });
      },
      name: "openai",
      streamChat(_input: GenerateChatInput, handlers) {
        const result = take();

        if (result.content) {
          handlers.onChunk(result.content);
        }

        return Promise.resolve(result);
      },
    } satisfies ProviderClient,
  };
}

const toolCall = { arguments: { message: "hi" }, id: "call_1", name: "slow" };

const callThenReply: ChatCompletionResult[] = [
  {
    assistantMessage: { content: "", role: "assistant", toolCalls: [toolCall] },
    content: "",
    toolCalls: [toolCall],
  },
  {
    assistantMessage: { content: "Done", role: "assistant" },
    content: "Done",
    toolCalls: [],
  },
];

describe("agent chat cancellation", () => {
  for (const parallelSafe of [false, true]) {
    test(`preserves completed tools and closes interrupted calls (parallel: ${parallelSafe})`, async () => {
      const controller = new AbortController();

      const tools: ToolDefinition[] = [
        {
          description: "Completes",
          name: "completed",
          parallelSafe,
          parameters: { properties: {}, type: "object" },
          run: () => Promise.resolve({ saved: true }),
        },
        {
          description: "Cancels",
          name: "cancel",
          parallelSafe,
          parameters: { properties: {}, type: "object" },
          run() {
            controller.abort();

            return Promise.reject(controller.signal.reason);
          },
        },
      ];

      const calls = tools.map((tool) => ({
        arguments: {},
        id: tool.name,
        name: tool.name,
      }));

      const { provider, getCallCount } = createCountingProvider([
        {
          assistantMessage: {
            content: "Working",
            role: "assistant",
            toolCalls: calls,
          },
          content: "Working",
          toolCalls: calls,
        },
      ]);

      const session = createAgentChatSession({ provider, tools }, { tools });
      await expect(
        session.sendStream(
          "Run tools",
          { onChunk() {} },
          { signal: controller.signal }
        )
      ).rejects.toThrow();
      expect(getCallCount()).toBe(1);
      expect(session.getHistory()).toEqual([
        { content: "Run tools", role: "user" },
        { content: "Working", role: "assistant", toolCalls: calls },
        expect.objectContaining({
          content: JSON.stringify({ saved: true }),
          role: "tool",
          toolCallId: "completed",
        }),
        expect.objectContaining({ role: "tool", toolCallId: "cancel" }),
      ]);
    });
  }

  test("stops the tool loop and hands the signal to tools", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;

    const slowTool: ToolDefinition = {
      description: "Cancels the turn while it runs",
      name: "slow",
      parameters: { properties: {}, type: "object" },
      run(_input: ToolCall["arguments"], context: ToolContext) {
        seenSignal = context.signal;
        controller.abort();

        return Promise.resolve({ ok: true });
      },
    };

    const { provider, getCallCount } = createCountingProvider(callThenReply);

    const session = createAgentChatSession(
      { provider, tools: [slowTool] },
      { tools: [slowTool] }
    );

    const promise = session.sendStream(
      "run it",
      { onChunk: () => {} },
      { signal: controller.signal }
    );

    expect(promise).rejects.toThrow();
    await promise.catch((cause: Error) => {
      expect(cause.name).toBe("AbortError");
    });

    expect(seenSignal?.aborted).toBe(true);
    // The second provider call is the one the loop would make after the tool
    // result. A cancelled turn must not reach it.
    expect(getCallCount()).toBe(1);
  });

  test("hands the signal to the provider so the request can be aborted", async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;

    const provider: ProviderClient = {
      generateChat: (input: GenerateChatInput) => {
        providerSignal = input.signal;

        // SAFETY: The test has exactly two prepared provider responses.
        return Promise.resolve(callThenReply[1] as ChatCompletionResult);
      },
      generateText: () => Promise.resolve({ content: "{}" }),
      name: "openai",
      streamChat: (input: GenerateChatInput) => {
        providerSignal = input.signal;

        // SAFETY: The test has exactly two prepared provider responses.
        return Promise.resolve(callThenReply[1] as ChatCompletionResult);
      },
    };

    const session = createAgentChatSession(
      { provider, tools: [] },
      { tools: [] }
    );

    await session.sendStream(
      "hello",
      { onChunk: () => {} },
      { signal: controller.signal }
    );

    // Without this the provider request outlives the cancel and the session
    // stays locked until the model finishes on its own.
    expect(providerSignal).toBe(controller.signal);
  });
});

describe("agent chat stream interruption", () => {
  function breakingProvider(breaks: number) {
    let calls = 0;

    const provider: ProviderClient = {
      generateChat: () => Promise.reject(new Error("stream only")),
      generateText: () => Promise.resolve({ content: "{}" }),
      name: "netra",
      streamChat(_input, handlers) {
        calls += 1;

        if (calls <= breaks) {
          handlers.onChunk("Part");
          handlers.onToolInputDelta?.({
            delta: "{",
            tool: "save",
            toolCallId: `c${calls}`,
          });

          return Promise.reject(new ProviderStreamInterruptedError("broke"));
        }

        handlers.onChunk(" Final");

        return Promise.resolve({
          assistantMessage: { content: " Final", role: "assistant" },
          content: " Final",
          toolCalls: [],
        });
      },
    };

    return { calls: () => calls, provider };
  }

  test("retries once and keeps the partial reply", async () => {
    const { calls, provider } = breakingProvider(1);
    const ended: string[] = [];
    const session = createAgentChatSession({ provider }, {});

    const reply = await session.sendStream("go", {
      onChunk() {},
      onToolEnd: (event) => ended.push(event.toolCallId),
    });

    expect(reply.trim()).toBe("Final");
    expect(calls()).toBe(2);
    expect(ended).toEqual(["c1"]);
    expect(
      session
        .getHistory()
        .filter((message) => message.role === "assistant")
        .map((message) => message.content)
    ).toEqual(["Part", " Final"]);
  });

  test("fails the turn when the stream breaks again", async () => {
    const { calls, provider } = breakingProvider(2);
    const session = createAgentChatSession({ provider }, {});

    await expect(
      session.sendStream("go", { onChunk() {} })
    ).rejects.toBeInstanceOf(ProviderStreamInterruptedError);
    expect(calls()).toBe(2);
  });
});
