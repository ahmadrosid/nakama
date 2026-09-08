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

const done = {
  assistantMessage: { content: "Done", role: "assistant" as const },
  content: "Done",
  toolCalls: [],
};

const localTool: ToolDefinition = {
  description: "Sample tool",
  name: "sample",
  run(input) {
    return Promise.resolve(input);
  },
};

async function turn(
  tools: ToolDefinition[],
  name: ProviderClient["name"] = "anthropic"
) {
  const provider = createCapturingProvider(done, name);
  const session = createAgentChatSession({ provider, tools }, { tools });
  await session.send("hello");
  return provider.lastInput;
}

describe("provider-native web search", () => {
  test("passes webSearch provider option when web_search is assigned", async () => {
    const input = await turn([webSearchTool]);

    expect(input?.providerOptions).toEqual({ webSearch: true });
    expect(input?.tools).toBeUndefined();
    expect(input?.system).not.toContain("Web search is unavailable");
  });

  test("keeps local tools while enabling provider web search", async () => {
    const input = await turn([localTool, webSearchTool]);

    expect(input?.providerOptions).toEqual({ webSearch: true });
    expect(input?.tools?.map((tool) => tool.name)).toEqual(["sample"]);
  });

  test("tells the model when OpenRouter drops hosted web search", async () => {
    const input = await turn([webSearchTool], "openrouter");

    expect(input?.providerOptions).toBeUndefined();
    expect(input?.system).toContain("Web search is unavailable on this turn");
  });

  test("points the model at web_fetch when that tool is assigned", async () => {
    const webFetch: ToolDefinition = {
      description: "Fetch a URL",
      name: "web_fetch",
      run(input) {
        return Promise.resolve(input);
      },
    };

    const input = await turn([webFetch, webSearchTool], "openrouter");

    expect(input?.system).toContain("read it with web_fetch");
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

    const input = await turn([customWebSearch], "openrouter");

    expect(input?.tools?.map((tool) => tool.name)).toEqual(["web_search"]);
    expect(input?.system).not.toContain("Web search is unavailable");
  });

  test("skips provider web search on Gemini when local tools are also assigned", async () => {
    const input = await turn([localTool, webSearchTool], "gemini");

    expect(input?.providerOptions).toBeUndefined();
    expect(input?.tools?.map((tool) => tool.name)).toEqual(["sample"]);
    expect(input?.system).toContain("Web search is unavailable on this turn");
  });
});
