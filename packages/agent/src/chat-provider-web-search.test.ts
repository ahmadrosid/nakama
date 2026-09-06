import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  GenerateChatInput,
  ProviderClient,
  ToolDefinition,
} from "@nakama/core";
import { webSearchTool } from "@nakama/core";
import { createAgentChatSession } from "./index";

function createCapturingProvider(
  response: ChatCompletionResult,
  name: ProviderClient["name"] = "anthropic"
): ProviderClient & { lastInput?: GenerateChatInput } {
  const provider: ProviderClient & { lastInput?: GenerateChatInput } = {
    generateChat(input) {
      provider.lastInput = input;
      return Promise.resolve(response);
    },
    generateText() {
      return Promise.resolve({ content: "{}" });
    },
    name,
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
      assistantMessage: {
        content: "Latest news summary.",
        role: "assistant",
      },
      content: "Latest news summary.",
      toolCalls: [],
    });

    const session = createAgentChatSession(
      { provider, tools: [webSearchTool] },
      { tools: [webSearchTool] }
    );
    const reply = await session.send("What's new in AI?");

    expect(reply).toBe("Latest news summary.");
    expect(provider.lastInput?.providerOptions).toEqual({ webSearch: true });
    expect(provider.lastInput?.tools).toBeUndefined();
  });

  test("keeps local tools while enabling provider web search", async () => {
    const localTool: ToolDefinition = {
      description: "Sample tool",
      name: "sample",
      run(input) {
        return Promise.resolve(input);
      },
    };

    const provider = createCapturingProvider({
      assistantMessage: {
        content: "Done",
        role: "assistant",
      },
      content: "Done",
      toolCalls: [],
    });

    const session = createAgentChatSession(
      {
        provider,
        tools: [localTool, webSearchTool],
      },
      {
        tools: [localTool, webSearchTool],
      }
    );
    await session.send("hello");

    expect(provider.lastInput?.providerOptions).toEqual({ webSearch: true });
    expect(provider.lastInput?.tools?.map((tool) => tool.name)).toEqual([
      "sample",
    ]);
  });

  test("enables provider web search on Gemini when web_search is the only tool", async () => {
    const provider = createCapturingProvider(
      {
        assistantMessage: {
          content: "Latest news summary.",
          role: "assistant",
        },
        content: "Latest news summary.",
        toolCalls: [],
      },
      "gemini"
    );

    const session = createAgentChatSession(
      { provider, tools: [webSearchTool] },
      { tools: [webSearchTool] }
    );
    await session.send("What's new in AI?");

    expect(provider.lastInput?.providerOptions).toEqual({ webSearch: true });
    expect(provider.lastInput?.tools).toBeUndefined();
  });

  test("tells the model when OpenRouter drops hosted web search", async () => {
    const provider = createCapturingProvider(
      {
        assistantMessage: { content: "Done", role: "assistant" },
        content: "Done",
        toolCalls: [],
      },
      "openrouter"
    );

    const session = createAgentChatSession(
      { provider, tools: [webSearchTool] },
      { tools: [webSearchTool] }
    );
    await session.send("What's new in AI?");

    expect(provider.lastInput?.providerOptions).toBeUndefined();
    expect(provider.lastInput?.system).toContain(
      "Web search is unavailable on this turn"
    );
  });

  test("points the model at web_fetch when that tool is assigned", async () => {
    const webFetch: ToolDefinition = {
      description: "Fetch a URL",
      name: "web_fetch",
      run(input) {
        return Promise.resolve(input);
      },
    };

    const provider = createCapturingProvider(
      {
        assistantMessage: { content: "Done", role: "assistant" },
        content: "Done",
        toolCalls: [],
      },
      "openrouter"
    );

    const session = createAgentChatSession(
      {
        provider,
        tools: [webFetch, webSearchTool],
      },
      {
        tools: [webFetch, webSearchTool],
      }
    );
    await session.send("hello");

    expect(provider.lastInput?.system).toContain("read it with web_fetch");
  });

  test("stays silent about web search when the provider does run it", async () => {
    const provider = createCapturingProvider({
      assistantMessage: { content: "Done", role: "assistant" },
      content: "Done",
      toolCalls: [],
    });

    const session = createAgentChatSession(
      { provider, tools: [webSearchTool] },
      { tools: [webSearchTool] }
    );
    await session.send("hello");

    expect(provider.lastInput?.providerOptions).toEqual({ webSearch: true });
    expect(provider.lastInput?.system).not.toContain(
      "Web search is unavailable"
    );
  });

  test("stays silent when web_search is served by a local search back-end", async () => {
    const customWebSearch: ToolDefinition = {
      description: "Search via a configured endpoint",
      hosted: false,
      name: "web_search",
      run() {
        return Promise.resolve({ results: [] });
      },
    };

    const provider = createCapturingProvider(
      {
        assistantMessage: { content: "Done", role: "assistant" },
        content: "Done",
        toolCalls: [],
      },
      "openrouter"
    );

    const session = createAgentChatSession(
      {
        provider,
        tools: [customWebSearch],
      },
      { tools: [customWebSearch] }
    );
    await session.send("hello");

    expect(provider.lastInput?.tools?.map((tool) => tool.name)).toEqual([
      "web_search",
    ]);
    expect(provider.lastInput?.system).not.toContain(
      "Web search is unavailable"
    );
  });

  test("skips provider web search on Gemini when local tools are also assigned", async () => {
    const localTool: ToolDefinition = {
      description: "Sample tool",
      name: "sample",
      run(input) {
        return Promise.resolve(input);
      },
    };

    const provider = createCapturingProvider(
      {
        assistantMessage: {
          content: "Done",
          role: "assistant",
        },
        content: "Done",
        toolCalls: [],
      },
      "gemini"
    );

    const session = createAgentChatSession(
      {
        provider,
        tools: [localTool, webSearchTool],
      },
      {
        tools: [localTool, webSearchTool],
      }
    );
    await session.send("hello");

    expect(provider.lastInput?.providerOptions).toBeUndefined();
    expect(provider.lastInput?.tools?.map((tool) => tool.name)).toEqual([
      "sample",
    ]);
    expect(provider.lastInput?.system).toContain(
      "Web search is unavailable on this turn"
    );
  });
});
