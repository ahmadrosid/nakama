import { describe, expect, test } from "bun:test";
import type { ProviderClient, ToolDefinition } from "@nakama/core";
import { webSearchTool } from "@nakama/core";
import { createAgentChatSession } from "./index";
import { createCapturingProvider } from "./test-helpers";

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
  const provider = createCapturingProvider(done, { name });
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

  test("skips provider web search on Gemini when local tools are also assigned", async () => {
    const input = await turn([localTool, webSearchTool], "gemini");

    expect(input?.providerOptions).toBeUndefined();
    expect(input?.tools?.map((tool) => tool.name)).toEqual(["sample"]);
    expect(input?.system).toContain("Web search is unavailable on this turn");
  });
});
