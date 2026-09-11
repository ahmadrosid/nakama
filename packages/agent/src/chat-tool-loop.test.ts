import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  ProviderClient,
  ToolDefinition,
} from "@nakama/core";
import { createAgentChatSession } from "./index";

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

function toolTurn(
  toolCalls: NonNullable<ChatCompletionResult["toolCalls"]>
): ChatCompletionResult {
  return {
    assistantMessage: { content: "", role: "assistant", toolCalls },
    content: "",
    toolCalls,
  };
}

function textReply(content: string): ChatCompletionResult {
  return {
    assistantMessage: { content, role: "assistant" },
    content,
    toolCalls: [],
  };
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

function delayedTool(
  name: string,
  options: {
    delayMs: number;
    parallelSafe?: boolean;
    track?: { active: number; max: number };
  }
): ToolDefinition {
  return {
    description: name,
    name,
    parallelSafe: options.parallelSafe,
    async run(input) {
      if (options.track) {
        options.track.active += 1;
        options.track.max = Math.max(options.track.max, options.track.active);
      }
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.track) {
        options.track.active -= 1;
      }
      return input;
    },
  };
}

describe("agent chat tool loop", () => {
  test("stream stops accumulating large tool results before another provider call and resets the budget next turn", async () => {
    let providerCalls = 0;
    let toolRuns = 0;
    const tool: ToolDefinition = {
      ...sampleTool,
      async run() {
        toolRuns += 1;
        return "x".repeat(128_000);
      },
    };
    const provider: ProviderClient = {
      ...createMockProvider([]),
      async generateChat() {
        providerCalls += 1;
        const toolCalls =
          providerCalls <= 8
            ? [
                {
                  arguments: {},
                  id: `call_${providerCalls}`,
                  name: tool.name,
                },
              ]
            : [];
        return {
          assistantMessage: { content: "", role: "assistant", toolCalls },
          content: "",
          toolCalls,
        };
      },
      streamChat(input) {
        return this.generateChat(input);
      },
    };
    const session = createAgentChatSession({ provider }, { tools: [tool] });
    let streamed = "";
    const reply = await session.sendStream("Read the files", {
      onChunk: (chunk) => {
        streamed += chunk;
      },
    });
    expect(providerCalls).toBe(7);
    expect(toolRuns).toBe(7);
    expect(reply.length).toBeGreaterThan(0);
    expect(session.getHistory().at(-1)).toEqual({
      content: reply,
      role: "assistant",
    });
    expect(
      session.getHistory().filter((message) => message.role === "tool")
    ).toHaveLength(7);
    expect(streamed).toBe(reply);
    await session.send("Continue");
    expect(providerCalls).toBe(9);
    expect(toolRuns).toBe(8);
  });

  test("counts every result in a batch", async () => {
    const tool: ToolDefinition = {
      ...sampleTool,
      parallelSafe: true,
      async run() {
        return "x".repeat(450_000);
      },
    };
    const toolCalls = ["first", "second"].map((id) => ({
      arguments: {},
      id,
      name: tool.name,
    }));
    const provider = createMockProvider([
      {
        assistantMessage: { content: "", role: "assistant", toolCalls },
        content: "",
        toolCalls,
      },
    ]);
    const session = createAgentChatSession({ provider }, { tools: [tool] });
    const reply = await session.send("Read both files");
    expect(reply.length).toBeGreaterThan(0);
    expect(
      session
        .getHistory()
        .filter((message) => message.role === "tool")
        .map((message) => message.toolCallId)
    ).toEqual(["first", "second"]);
    expect(session.getHistory().at(-1)).toEqual({
      content: reply,
      role: "assistant",
    });
  });

  test.each(["reported", "estimated"])(
    "%s assistant output consumes the budget before tools execute",
    async (source) => {
      let toolRuns = 0;
      const tool: ToolDefinition = {
        ...sampleTool,
        async run() {
          toolRuns += 1;
          return {};
        },
      };
      const toolCalls = [{ arguments: {}, id: "unexecuted", name: tool.name }];
      const partialReply = "Here is what the analysis found.";
      const provider = createMockProvider([
        {
          assistantMessage: {
            content: partialReply,
            role: "assistant",
            thinking: source === "estimated" ? "x".repeat(800_000) : "",
            toolCalls,
          },
          content: partialReply,
          toolCalls,
          usage:
            source === "reported"
              ? { inputTokens: 1, outputTokens: 200_000, totalTokens: 200_001 }
              : undefined,
        },
      ]);
      const session = createAgentChatSession({ provider }, { tools: [tool] });
      let streamed = "";
      const reply = await session.sendStream("Think first", {
        onChunk: (chunk) => {
          streamed += chunk;
        },
      });
      expect(toolRuns).toBe(0);
      expect(reply.startsWith(partialReply)).toBe(true);
      expect(reply.length).toBeGreaterThan(partialReply.length);
      expect(streamed).toBe(reply);
      expect(session.getHistory()).toEqual([
        { content: "Think first", role: "user" },
        { content: reply, role: "assistant" },
      ]);
    }
  );

  test("handles a single tool call then a final reply", async () => {
    const provider = createMockProvider([
      toolTurn([
        { arguments: { message: "hi" }, id: "call_1", name: "sample" },
      ]),
      textReply("Done"),
    ]);

    const session = createAgentChatSession(
      { provider, tools: [sampleTool] },
      { tools: [sampleTool] }
    );
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
      toolTurn([
        { arguments: { message: "ping" }, id: "call_1", name: "sample" },
      ]),
      textReply("done"),
    ]);

    const session = createAgentChatSession(
      { provider, tools: [sampleTool] },
      { tools: [sampleTool] }
    );
    const events: string[] = [];

    await session.sendStream("go", {
      onChunk: (delta) => events.push(`chunk:${delta}`),
      onToolEnd: (event) => events.push(`end:${event.tool}`),
      onToolStart: (event) => events.push(`start:${event.tool}`),
    });

    expect(events).toEqual(["start:sample", "end:sample", "chunk:done"]);
  });

  test("runs parallelSafe tool calls concurrently and preserves history order", async () => {
    const track = { active: 0, max: 0 };
    const parallelTool = delayedTool("parallel_sample", {
      delayMs: 20,
      parallelSafe: true,
      track,
    });

    const provider = createMockProvider([
      toolTurn([
        { arguments: { message: "a" }, id: "call_a", name: "parallel_sample" },
        { arguments: { message: "b" }, id: "call_b", name: "parallel_sample" },
      ]),
      textReply("Done"),
    ]);

    const session = createAgentChatSession(
      { provider, tools: [parallelTool] },
      { tools: [parallelTool] }
    );
    const events: string[] = [];
    const reply = await session.sendStream("run both", {
      onChunk: (delta) => events.push(`chunk:${delta}`),
      onToolEnd: (event) => events.push(`end:${event.toolCallId}`),
      onToolStart: (event) => events.push(`start:${event.toolCallId}`),
    });

    expect(reply).toBe("Done");
    expect(track.max).toBe(2);
    expect(events.filter((event) => event.startsWith("start:"))).toHaveLength(
      2
    );
    expect(events.filter((event) => event.startsWith("end:"))).toHaveLength(2);
    expect(events.at(-1)).toBe("chunk:Done");

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
    const track = { active: 0, max: 0 };
    const parallelTool = delayedTool("parallel_sample", {
      delayMs: 10,
      parallelSafe: true,
      track,
    });
    const sequentialTool = delayedTool("sequential_sample", {
      delayMs: 10,
      track,
    });

    const provider = createMockProvider([
      toolTurn([
        { arguments: { message: "a" }, id: "call_a", name: "parallel_sample" },
        {
          arguments: { message: "b" },
          id: "call_b",
          name: "sequential_sample",
        },
      ]),
      textReply("Done"),
    ]);

    const session = createAgentChatSession(
      {
        provider,
        tools: [parallelTool, sequentialTool],
      },
      {
        tools: [parallelTool, sequentialTool],
      }
    );
    await session.send("run mixed");

    expect(track.max).toBe(1);
  });

  test("rolls back incomplete tool turns when follow-up provider call fails", async () => {
    const provider = createMockProvider([
      toolTurn([
        { arguments: { message: "hi" }, id: "call_1", name: "sample" },
      ]),
    ]);

    const session = createAgentChatSession(
      { provider, tools: [sampleTool] },
      { tools: [sampleTool] }
    );

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
        return Promise.resolve(textReply("done"));
      },
      generateText() {
        return Promise.resolve({ content: "{}" });
      },
      name: "openai",
      streamChat(input, handlers) {
        systems.push(input.system);
        handlers.onChunk("done");
        return Promise.resolve(textReply("done"));
      },
    };

    const session = createAgentChatSession(
      { provider },
      {
        resolvePromptContext: () =>
          "# Active Task Plan\n- [pending] Ship (id: 1)",
      }
    );

    await session.send("hello");

    expect(systems[0]).toContain("[pending] Ship");
  });
});

describe("plugin tool discovery", () => {
  test.each(["send", "stream"])(
    "loads only requested definitions and resets next turn (%s)",
    async (mode) => {
      const snapshots: string[][] = [];
      let runs = 0;
      const plugin: ToolDefinition = {
        ...sampleTool,
        discoveryGroup: "workflows",
        name: "plugin_workflows__run_workflow",
        async run() {
          runs++;
          return { ok: true };
        },
      };
      const other = { ...plugin, name: "plugin_workflows__create_workflow" };
      const replies = [
        toolTurn([
          {
            arguments: { query: "run workflows" },
            id: "discover",
            name: "find_tools",
          },
        ]),
        toolTurn([{ arguments: {}, id: "run", name: plugin.name }]),
        textReply("Done"),
        textReply("Hello"),
      ];
      const generate = (input: GenerateChatInput) => {
        snapshots.push(input.tools?.map((tool) => tool.name) ?? []);
        return Promise.resolve(replies.shift()!);
      };
      const provider: ProviderClient = {
        generateChat: generate,
        generateText: async () => ({ content: "" }),
        name: "openai",
        streamChat: async (input, handlers) => {
          const result = await generate(input);
          handlers.onChunk(result.content);
          return result;
        },
      };
      const session = createAgentChatSession({
        provider,
        tools: [sampleTool, plugin, other],
      });
      if (mode === "send") {
        await session.send("Run my workflow");
      } else {
        await session.sendStream("Run my workflow", { onChunk() {} });
      }
      await session.send("Hello");
      expect(snapshots[0]).toEqual(["sample", "find_tools"]);
      expect(snapshots[1]).toEqual(["sample", "find_tools", plugin.name]);
      expect(snapshots[2]).toEqual(snapshots[1]);
      expect(snapshots[3]).toEqual(snapshots[0]);
      expect(runs).toBe(1);
    }
  );

  test("undiscovered calls, including the discovery batch, cannot execute", async () => {
    let runs = 0;
    const plugin: ToolDefinition = {
      ...sampleTool,
      discoveryGroup: "workflows",
      name: "plugin_workflows__run",
      async run() {
        runs++;
        return {};
      },
    };
    const session = createAgentChatSession({
      provider: createMockProvider([
        toolTurn([{ arguments: {}, id: "guess", name: plugin.name }]),
        toolTurn([
          {
            arguments: { query: "workflows" },
            id: "discover",
            name: "find_tools",
          },
          { arguments: {}, id: "early", name: plugin.name },
        ]),
        toolTurn([{ arguments: {}, id: "ready", name: plugin.name }]),
        textReply("Done"),
      ]),
      tools: [plugin],
    });
    await session.send("Run");
    expect(runs).toBe(1);
    const results = session
      .getHistory()
      .filter((message) => message.role === "tool");
    expect(results[0]?.content).toContain("Unknown tool");
    expect(results[2]?.content).toContain("Unknown tool");
  });
});
