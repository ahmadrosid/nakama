import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ChatMessage } from "@nakama/core";
import { generateOpenAIResponsesChat, toResponsesInput } from "./openai";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ASSISTANT_TEXT = "Let me look up the invoices from last quarter.";

// The shape the Responses API returns for a turn that says something and then
// calls a tool: one message item, one function_call item.
const RESPONSE_PAYLOAD = {
  output: [
    {
      content: [{ text: ASSISTANT_TEXT, type: "output_text" }],
      id: "msg_1",
      role: "assistant",
      status: "completed",
      type: "message",
    },
    {
      arguments: '{"query":"invoice"}',
      call_id: "call_1",
      id: "fc_1",
      name: "search_invoices",
      status: "completed",
      type: "function_call",
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5 },
};

function itemsCarrying(items: unknown[], text: string): unknown[] {
  return items.filter((item) => JSON.stringify(item).includes(text));
}

describe("OpenAI Responses assistant replay", () => {
  test("sends the assistant text once", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify(RESPONSE_PAYLOAD), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
    ) as unknown as typeof fetch;

    const result = await generateOpenAIResponsesChat({
      apiKey: "sk-test",
      input: { messages: [{ content: "invoices", role: "user" }], system: "s" },
      model: "gpt-5.4",
      stream: false,
    });

    const replay = await toResponsesInput([
      { content: "invoices", role: "user" },
      result.assistantMessage,
    ]);

    expect(itemsCarrying(replay, ASSISTANT_TEXT)).toHaveLength(1);
  });

  test("still sends the text when there is no providerContent", async () => {
    const history: ChatMessage[] = [
      { content: "invoices", role: "user" },
      {
        content: ASSISTANT_TEXT,
        role: "assistant",
        toolCalls: [
          {
            arguments: { query: "invoice" },
            id: "call_1",
            name: "search_invoices",
          },
        ],
      },
    ];

    const replay = await toResponsesInput(history);
    const carrying = itemsCarrying(replay, ASSISTANT_TEXT);

    expect(carrying).toHaveLength(1);
    expect(carrying[0]).toEqual({
      content: [{ text: ASSISTANT_TEXT, type: "output_text" }],
      role: "assistant",
      type: "message",
    });
  });
});
