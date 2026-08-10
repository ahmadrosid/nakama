import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  ProviderClient,
  ToolDefinition,
} from "@nakama/core";
import { createAgentHarness } from "./index";

function createMockProvider(responses: ChatCompletionResult[]): ProviderClient {
  let callIndex = 0;

  return {
    generateChat(input: GenerateChatInput) {
      return Promise.resolve(takeResponse(responses, callIndex++, input));
    },
    generateText() {
      return Promise.resolve({ content: "{}" });
    },
    name: "openai",
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
  input: GenerateChatInput
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
  description: "Sample tool for tests",
  name: "sample",
  parameters: {
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
    type: "object",
  },
  run(input) {
    return Promise.resolve(input);
  },
};

describe("agent chat tool loop", () => {
  test("handles a single tool call then a final reply", async () => {
    const provider = createMockProvider([
      {
        assistantMessage: {
          content: "",
          role: "assistant",
          toolCalls: [
            { arguments: { message: "hi" }, id: "call_1", name: "sample" },
          ],
        },
        content: "",
        toolCalls: [
          { arguments: { message: "hi" }, id: "call_1", name: "sample" },
        ],
      },
      {
        assistantMessage: {
          content: "Done",
          role: "assistant",
        },
        content: "Done",
        toolCalls: [],
      },
    ]);

    const harness = createAgentHarness({ provider, tools: [sampleTool] });
    const session = harness.createChatSession({ tools: [sampleTool] });
    const reply = await session.send("say hi");

    expect(reply).toBe("Done");

    const history = session.getHistory() as ChatMessage[];
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ content: "say hi", role: "user" });
    expect(history[1]?.role).toBe("assistant");
    expect(history[2]).toMatchObject({
      content: '{"message":"hi"}',
      name: "sample",
      role: "tool",
      toolCallId: "call_1",
    });
    expect(history[3]).toEqual({ content: "Done", role: "assistant" });
  });

  test("fires tool stream handlers", async () => {
    const provider = createMockProvider([
      {
        assistantMessage: {
          content: "",
          role: "assistant",
          toolCalls: [
            { arguments: { message: "ping" }, id: "call_1", name: "sample" },
          ],
        },
        content: "",
        toolCalls: [
          { arguments: { message: "ping" }, id: "call_1", name: "sample" },
        ],
      },
      {
        assistantMessage: {
          content: "done",
          role: "assistant",
        },
        content: "done",
        toolCalls: [],
      },
    ]);

    const harness = createAgentHarness({ provider, tools: [sampleTool] });
    const session = harness.createChatSession({ tools: [sampleTool] });
    const events: string[] = [];

    await session.sendStream("go", {
      onChunk: (delta) => events.push(`chunk:${delta}`),
      onToolEnd: (event) => events.push(`end:${event.tool}`),
      onToolStart: (event) => events.push(`start:${event.tool}`),
    });

    expect(events).toEqual(["start:sample", "end:sample", "chunk:done"]);
  });

  test("fires parallel tool stream handlers", async () => {
    const parallelTool: ToolDefinition = {
      description: "Parallel-safe sample tool",
      name: "parallel_sample",
      parallelSafe: true,
      async run(input) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return input;
      },
    };

    const provider = createMockProvider([
      {
        assistantMessage: {
          content: "",
          role: "assistant",
          toolCalls: [
            {
              arguments: { message: "a" },
              id: "call_a",
              name: "parallel_sample",
            },
            {
              arguments: { message: "b" },
              id: "call_b",
              name: "parallel_sample",
            },
          ],
        },
        content: "",
        toolCalls: [
          {
            arguments: { message: "a" },
            id: "call_a",
            name: "parallel_sample",
          },
          {
            arguments: { message: "b" },
            id: "call_b",
            name: "parallel_sample",
          },
        ],
      },
      {
        assistantMessage: {
          content: "done",
          role: "assistant",
        },
        content: "done",
        toolCalls: [],
      },
    ]);

    const harness = createAgentHarness({ provider, tools: [parallelTool] });
    const session = harness.createChatSession({ tools: [parallelTool] });
    const events: string[] = [];

    await session.sendStream("go", {
      onChunk: (delta) => events.push(`chunk:${delta}`),
      onToolEnd: (event) => events.push(`end:${event.toolCallId}`),
      onToolStart: (event) => events.push(`start:${event.toolCallId}`),
    });

    expect(events.filter((event) => event.startsWith("start:"))).toHaveLength(
      2
    );
    expect(events.filter((event) => event.startsWith("end:"))).toHaveLength(2);
    expect(events.at(-1)).toBe("chunk:done");
  });

  test("runs parallelSafe tool calls concurrently and preserves history order", async () => {
    let active = 0;
    let maxActive = 0;

    const parallelTool: ToolDefinition = {
      description: "Parallel-safe delayed sample tool",
      name: "parallel_sample",
      parallelSafe: true,
      async run(input) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return input;
      },
    };

    const provider = createMockProvider([
      {
        assistantMessage: {
          content: "",
          role: "assistant",
          toolCalls: [
            {
              arguments: { message: "a" },
              id: "call_a",
              name: "parallel_sample",
            },
            {
              arguments: { message: "b" },
              id: "call_b",
              name: "parallel_sample",
            },
          ],
        },
        content: "",
        toolCalls: [
          {
            arguments: { message: "a" },
            id: "call_a",
            name: "parallel_sample",
          },
          {
            arguments: { message: "b" },
            id: "call_b",
            name: "parallel_sample",
          },
        ],
      },
      {
        assistantMessage: {
          content: "Done",
          role: "assistant",
        },
        content: "Done",
        toolCalls: [],
      },
    ]);

    const harness = createAgentHarness({ provider, tools: [parallelTool] });
    const session = harness.createChatSession({ tools: [parallelTool] });
    const reply = await session.send("run both");

    expect(reply).toBe("Done");
    expect(maxActive).toBe(2);

    const history = session.getHistory() as ChatMessage[];
    expect(history[2]).toMatchObject({
      content: '{"message":"a"}',
      role: "tool",
      toolCallId: "call_a",
    });
    expect(history[3]).toMatchObject({
      content: '{"message":"b"}',
      role: "tool",
      toolCallId: "call_b",
    });
  });

  test("falls back to sequential execution when any tool is not parallelSafe", async () => {
    let active = 0;
    let maxActive = 0;

    const parallelTool: ToolDefinition = {
      description: "Parallel-safe delayed sample tool",
      name: "parallel_sample",
      parallelSafe: true,
      async run(input) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return input;
      },
    };

    const sequentialTool: ToolDefinition = {
      description: "Sequential sample tool",
      name: "sequential_sample",
      async run(input) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return input;
      },
    };

    const provider = createMockProvider([
      {
        assistantMessage: {
          content: "",
          role: "assistant",
          toolCalls: [
            {
              arguments: { message: "a" },
              id: "call_a",
              name: "parallel_sample",
            },
            {
              arguments: { message: "b" },
              id: "call_b",
              name: "sequential_sample",
            },
          ],
        },
        content: "",
        toolCalls: [
          {
            arguments: { message: "a" },
            id: "call_a",
            name: "parallel_sample",
          },
          {
            arguments: { message: "b" },
            id: "call_b",
            name: "sequential_sample",
          },
        ],
      },
      {
        assistantMessage: {
          content: "Done",
          role: "assistant",
        },
        content: "Done",
        toolCalls: [],
      },
    ]);

    const harness = createAgentHarness({
      provider,
      tools: [parallelTool, sequentialTool],
    });
    const session = harness.createChatSession({
      tools: [parallelTool, sequentialTool],
    });
    await session.send("run mixed");

    expect(maxActive).toBe(1);
  });

  test("rolls back incomplete tool turns when follow-up provider call fails", async () => {
    const provider = createMockProvider([
      {
        assistantMessage: {
          content: "",
          role: "assistant",
          toolCalls: [
            { arguments: { message: "hi" }, id: "call_1", name: "sample" },
          ],
        },
        content: "",
        toolCalls: [
          { arguments: { message: "hi" }, id: "call_1", name: "sample" },
        ],
      },
    ]);

    const harness = createAgentHarness({ provider, tools: [sampleTool] });
    const session = harness.createChatSession({ tools: [sampleTool] });

    await expect(session.send("say hi")).rejects.toThrow(
      "Unexpected provider call 2"
    );
    expect(session.getHistory()).toEqual([]);
  });

  test("appends resolvePromptContext to the system prompt each turn", async () => {
    const systems: string[] = [];
    const provider: ProviderClient = {
      generateChat(input) {
        systems.push(input.system);
        return Promise.resolve({
          assistantMessage: { content: "done", role: "assistant" },
          content: "done",
        });
      },
      generateText() {
        return Promise.resolve({ content: "{}" });
      },
      name: "openai",
      streamChat(input, handlers) {
        systems.push(input.system);
        handlers.onChunk("done");
        return Promise.resolve({
          assistantMessage: { content: "done", role: "assistant" },
          content: "done",
        });
      },
    };

    const harness = createAgentHarness({ provider });
    const session = harness.createChatSession({
      resolvePromptContext: () =>
        "# Active Task Plan\n- [pending] Ship (id: 1)",
    });

    await session.send("hello");

    expect(systems[0]).toContain("[pending] Ship");
  });
});
