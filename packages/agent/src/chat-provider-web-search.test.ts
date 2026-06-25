import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  GenerateChatInput,
  ProviderClient,
  ToolDefinition,
} from "@tinyclaw/core";
import { webSearchTool } from "@tinyclaw/core";
import { createAgentHarness } from "./index";

function createCapturingProvider(
  response: ChatCompletionResult,
  name: ProviderClient["name"] = "anthropic",
): ProviderClient & { lastInput?: GenerateChatInput } {
  const provider: ProviderClient & { lastInput?: GenerateChatInput } = {
    name,
    generateText() {
      return Promise.resolve({ content: "{}" });
    },
    generateChat(input) {
      provider.lastInput = input;
      return Promise.resolve(response);
    },
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

describe("provider-native web search", () => {
  test("passes webSearch provider option when web_search is assigned", async () => {
    const provider = createCapturingProvider({
      content: "Latest news summary.",
      toolCalls: [],
      assistantMessage: {
        role: "assistant",
        content: "Latest news summary.",
      },
    });

    const harness = createAgentHarness({ provider, tools: [webSearchTool] });
    const session = harness.createChatSession({ tools: [webSearchTool] });
    const reply = await session.send("What's new in AI?");

    expect(reply).toBe("Latest news summary.");
    expect(provider.lastInput?.providerOptions).toEqual({ webSearch: true });
    expect(provider.lastInput?.tools).toBeUndefined();
  });

  test("keeps local tools while enabling provider web search", async () => {
    const localTool: ToolDefinition = {
      name: "sample",
      description: "Sample tool",
      run(input) {
        return Promise.resolve(input);
      },
    };

    const provider = createCapturingProvider({
      content: "Done",
      toolCalls: [],
      assistantMessage: {
        role: "assistant",
        content: "Done",
      },
    });

    const harness = createAgentHarness({
      provider,
      tools: [localTool, webSearchTool],
    });
    const session = harness.createChatSession({ tools: [localTool, webSearchTool] });
    await session.send("hello");

    expect(provider.lastInput?.providerOptions).toEqual({ webSearch: true });
    expect(provider.lastInput?.tools?.map((tool) => tool.name)).toEqual(["sample"]);
  });

  test("enables provider web search on Gemini when web_search is the only tool", async () => {
    const provider = createCapturingProvider(
      {
        content: "Latest news summary.",
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "Latest news summary.",
        },
      },
      "gemini",
    );

    const harness = createAgentHarness({ provider, tools: [webSearchTool] });
    const session = harness.createChatSession({ tools: [webSearchTool] });
    await session.send("What's new in AI?");

    expect(provider.lastInput?.providerOptions).toEqual({ webSearch: true });
    expect(provider.lastInput?.tools).toBeUndefined();
  });

  test("skips provider web search on Gemini when local tools are also assigned", async () => {
    const localTool: ToolDefinition = {
      name: "sample",
      description: "Sample tool",
      run(input) {
        return Promise.resolve(input);
      },
    };

    const provider = createCapturingProvider(
      {
        content: "Done",
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "Done",
        },
      },
      "gemini",
    );

    const harness = createAgentHarness({
      provider,
      tools: [localTool, webSearchTool],
    });
    const session = harness.createChatSession({ tools: [localTool, webSearchTool] });
    await session.send("hello");

    expect(provider.lastInput?.providerOptions).toBeUndefined();
    expect(provider.lastInput?.tools?.map((tool) => tool.name)).toEqual(["sample"]);
  });
});
