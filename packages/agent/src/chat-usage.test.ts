import { describe, expect, test } from "bun:test";
import type {
  ChatCompletionResult,
  ChatUsage,
  ProviderClient,
  ToolDefinition,
} from "@nakama/core";
import { createAgentChatSession } from "./index";

const toolCall = { arguments: {}, id: "call_1", name: "ping" };

const pingTool: ToolDefinition = {
  description: "Replies pong",
  name: "ping",
  parameters: { properties: {}, type: "object" },
  run: () => Promise.resolve({ pong: true }),
};

const firstUsage: ChatUsage = {
  costUsd: 0.001,
  inputTokens: 100,
  outputTokens: 10,
  totalTokens: 110,
};
const secondUsage: ChatUsage = {
  costUsd: 0.002,
  inputTokens: 200,
  outputTokens: 20,
  totalTokens: 220,
};

function providerWithUsage(): ProviderClient {
  const responses: ChatCompletionResult[] = [
    {
      assistantMessage: {
        content: "",
        role: "assistant",
        toolCalls: [toolCall],
      },
      content: "",
      toolCalls: [toolCall],
      usage: firstUsage,
    },
    {
      assistantMessage: { content: "Done", role: "assistant" },
      content: "Done",
      toolCalls: [],
      usage: secondUsage,
    },
  ];
  const take = () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected provider call");
    }
    return next;
  };

  return {
    generateChat: () => Promise.resolve(take()),
    generateText: () => Promise.resolve({ content: "{}" }),
    name: "openai",
    streamChat: (_input, handlers) => {
      const result = take();
      if (result.content) {
        handlers.onChunk(result.content);
      }
      return Promise.resolve(result);
    },
  };
}

describe("per-call usage", () => {
  test("checks an organization quota before calling the provider", async () => {
    let calls = 0;
    const provider: ProviderClient = {
      generateChat: () => {
        calls += 1;
        return Promise.resolve({
          assistantMessage: { content: "Unexpected", role: "assistant" },
          content: "Unexpected",
          toolCalls: [],
        });
      },
      generateText: () => Promise.resolve({ content: "{}" }),
      name: "openai",
      streamChat: () => {
        calls += 1;
        return Promise.resolve({
          assistantMessage: { content: "Unexpected", role: "assistant" },
          content: "Unexpected",
          toolCalls: [],
        });
      },
    };
    const session = createAgentChatSession(
      { provider, tools: [] },
      {
        toolContext: {
          assertCanStartLlmTurn: () =>
            Promise.reject(new Error("Monthly LLM turn limit reached.")),
        },
      }
    );

    await expect(session.send("hi")).rejects.toThrow(
      "Monthly LLM turn limit reached."
    );
    expect(calls).toBe(0);
  });

  test("emits onUsage per LLM call and stores usage on history messages", async () => {
    const session = createAgentChatSession(
      { provider: providerWithUsage(), tools: [pingTool] },
      { enableToolLoop: true }
    );
    const seen: ChatUsage[] = [];

    await session.sendStream("hi", {
      onChunk: () => undefined,
      onUsage: (usage) => seen.push(usage),
    });

    expect(seen).toEqual([firstUsage, secondUsage]);

    const assistantUsages = session
      .getHistory()
      .filter((message) => message.role === "assistant")
      .map((message) =>
        message.role === "assistant" ? message.usage : undefined
      );
    expect(assistantUsages).toEqual([firstUsage, secondUsage]);
  });
  test("getTurnUsage totals the turn and keeps every call separate", async () => {
    const session = createAgentChatSession(
      { provider: providerWithUsage(), tools: [pingTool] },
      { enableToolLoop: true }
    );

    expect(session.getTurnUsage()).toBeNull();
    await session.send("hi");

    const usage = session.getTurnUsage();
    // Two provider calls: the tool call, then the reply. Billing has to split
    // them, so the totals never replace the per-call entries.
    expect(usage?.calls).toEqual([firstUsage, secondUsage]);
    expect(usage?.inputTokens).toBe(300);
    expect(usage?.outputTokens).toBe(30);
    expect(usage?.totalTokens).toBe(330);
    expect(usage?.costUsd).toBeCloseTo(0.003, 6);
    expect(usage?.estimated).toBe(false);
  });

  test("a fresh session reports only its own turn", async () => {
    const first = createAgentChatSession(
      { provider: providerWithUsage(), tools: [pingTool] },
      { enableToolLoop: true }
    );
    await first.send("hi");
    expect(first.getTurnUsage()?.calls).toHaveLength(2);

    const second = createAgentChatSession(
      { provider: providerWithUsage(), tools: [pingTool] },
      { enableToolLoop: true }
    );
    await second.send("hi");
    // Carrying the first session's totals over would bill that turn twice.
    expect(second.getTurnUsage()?.inputTokens).toBe(300);
  });

  test("a provider that reports nothing leaves the usage off", async () => {
    const silent: ProviderClient = {
      generateChat: () =>
        Promise.resolve({
          assistantMessage: { content: "Hi", role: "assistant" },
          content: "Hi",
          toolCalls: [],
        }),
      generateText: () => Promise.resolve({ content: "{}" }),
      name: "openai",
      streamChat: () =>
        Promise.resolve({
          assistantMessage: { content: "Hi", role: "assistant" },
          content: "Hi",
          toolCalls: [],
        }),
    };
    const session = createAgentChatSession({ provider: silent, tools: [] }, {});

    await session.send("hi");

    // Null rather than a zero-token turn, so a caller cannot bill for a number
    // the provider never gave, and the response field stays absent.
    expect(session.getTurnUsage()).toBeNull();
  });

  test("a turn that fails after a billed call still reports it", async () => {
    let call = 0;
    const flaky: ProviderClient = {
      generateChat: () => {
        call += 1;
        if (call === 1) {
          return Promise.resolve({
            assistantMessage: {
              content: "",
              role: "assistant",
              toolCalls: [toolCall],
            },
            content: "",
            toolCalls: [toolCall],
            usage: firstUsage,
          });
        }
        return Promise.reject(new Error("provider exploded"));
      },
      generateText: () => Promise.resolve({ content: "{}" }),
      name: "openai",
      streamChat: () => Promise.reject(new Error("provider exploded")),
    };
    const session = createAgentChatSession(
      { provider: flaky, tools: [pingTool] },
      { enableToolLoop: true }
    );

    await expect(session.send("hi")).rejects.toThrow("provider exploded");

    // The first call was served and charged. Reporting nothing here bills the
    // user for tokens the API never admitted to.
    expect(session.getTurnUsage()?.calls).toEqual([firstUsage]);
    expect(session.getTurnUsage()?.inputTokens).toBe(100);
  });
});
