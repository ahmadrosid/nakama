import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  GenerateChatInput,
  ProviderClient,
  ToolContext,
  ToolDefinition,
} from "@nakama/core";
import { createAgentHarness } from "./index";

function createCountingProvider(responses: ChatCompletionResult[]): {
  provider: ProviderClient;
  getCallCount: () => number;
} {
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
    },
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
  test("stops the tool loop and hands the signal to tools", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;

    const slowTool: ToolDefinition = {
      description: "Cancels the turn while it runs",
      name: "slow",
      parameters: { properties: {}, type: "object" },
      run(_input: unknown, context: ToolContext) {
        seenSignal = context.signal;
        controller.abort();
        return Promise.resolve({ ok: true });
      },
    };

    const { provider, getCallCount } = createCountingProvider(callThenReply);
    const harness = createAgentHarness({ provider, tools: [slowTool] });
    const session = harness.createChatSession({ tools: [slowTool] });

    const promise = session.sendStream(
      "run it",
      { onChunk: () => {} },
      { signal: controller.signal }
    );

    expect(promise).rejects.toThrow();
    await promise.catch((error: unknown) => {
      expect((error as Error).name).toBe("AbortError");
    });

    expect(seenSignal?.aborted).toBe(true);
    // The second provider call is the one the loop would make after the tool
    // result. A cancelled turn must not reach it.
    expect(getCallCount()).toBe(1);
  });

  test("runs to completion when nothing aborts", async () => {
    const controller = new AbortController();
    const tool: ToolDefinition = {
      description: "Sample tool",
      name: "slow",
      parameters: { properties: {}, type: "object" },
      run: () => Promise.resolve({ ok: true }),
    };

    const { provider } = createCountingProvider(callThenReply);
    const harness = createAgentHarness({ provider, tools: [tool] });
    const session = harness.createChatSession({ tools: [tool] });

    const reply = await session.sendStream(
      "run it",
      { onChunk: () => {} },
      { signal: controller.signal }
    );

    expect(reply).toBe("Done");
  });
});
