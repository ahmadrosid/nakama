import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  ProviderClient,
  ToolDefinition,
} from "@tinyclaw/core";
import { createAgentHarness } from "./index";

function createMockProvider(
  responses: ChatCompletionResult[],
): ProviderClient {
  let callIndex = 0;

  return {
    name: "openai",
    generateText() {
      return Promise.resolve("{}");
    },
    generateChat(input: GenerateChatInput) {
      return Promise.resolve(takeResponse(responses, callIndex++, input));
    },
    streamChat(input: GenerateChatInput, handlers) {
      const result = takeResponse(responses, callIndex++, input);

      if (result.content) {
        handlers.onChunk(result.content);
      }

      return Promise.resolve(result);
    },
  };
}

function takeResponse(
  responses: ChatCompletionResult[],
  index: number,
  input: GenerateChatInput,
): ChatCompletionResult {
  const response = responses[index];

  if (!response) {
    throw new Error(`Unexpected provider call ${index + 1}`);
  }

  if (index > 0) {
    const lastMessage = input.messages[input.messages.length - 1];

    if (lastMessage?.role !== "tool") {
      throw new Error("Expected tool result message before follow-up call");
    }
  }

  return response;
}

const sampleTool: ToolDefinition = {
  name: "sample",
  description: "Sample tool for tests",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
  },
  run(input) {
    return Promise.resolve(input);
  },
};

describe("agent chat tool loop", () => {
  test("handles a single tool call then a final reply", async () => {
    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [
          { id: "call_1", name: "sample", arguments: { message: "hi" } },
        ],
        assistantMessage: {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_1", name: "sample", arguments: { message: "hi" } },
          ],
        },
      },
      {
        content: "Done",
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "Done",
        },
      },
    ]);

    const harness = createAgentHarness({ provider, tools: [sampleTool] });
    const session = harness.createChatSession({ tools: [sampleTool] });
    const reply = await session.send("say hi");

    expect(reply).toBe("Done");

    const history = session.getHistory() as ChatMessage[];
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: "user", content: "say hi" });
    expect(history[1]?.role).toBe("assistant");
    expect(history[2]).toMatchObject({
      role: "tool",
      toolCallId: "call_1",
      name: "sample",
      content: '{"message":"hi"}',
    });
    expect(history[3]).toEqual({ role: "assistant", content: "Done" });
  });

  test("fires tool stream handlers", async () => {
    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [
          { id: "call_1", name: "sample", arguments: { message: "ping" } },
        ],
        assistantMessage: {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_1", name: "sample", arguments: { message: "ping" } },
          ],
        },
      },
      {
        content: "done",
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "done",
        },
      },
    ]);

    const harness = createAgentHarness({ provider, tools: [sampleTool] });
    const session = harness.createChatSession({ tools: [sampleTool] });
    const events: string[] = [];

    await session.sendStream("go", {
      onChunk: (delta) => events.push(`chunk:${delta}`),
      onToolStart: (event) => events.push(`start:${event.tool}`),
      onToolEnd: (event) => events.push(`end:${event.tool}`),
    });

    expect(events).toEqual(["start:sample", "end:sample", "chunk:done"]);
  });
});
