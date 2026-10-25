import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ChatMessage } from "@nakama/core";
import {
  generateOpenAIResponsesChat,
  toOpenAIMessages,
  toResponsesInput,
} from "./openai";
import { readRecord } from "./shared";
import { asTestFetch } from "./test-helpers";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ASSISTANT_TEXT = "Let me look up the invoices from last quarter.";

type ResponsesRequestBody = { store?: boolean };

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

// What a DeepSeek turn through Netra saves as providerContent.
const NETRA_REASONING = [
  {
    format: "unknown",
    text: "The user wants to log the receipt.",
    type: "reasoning.text",
  },
];

function itemsCarrying(items: unknown[], text: string): unknown[] {
  return items.filter((item) => JSON.stringify(item).includes(text));
}

describe("OpenAI Responses assistant replay", () => {
  test("sends the assistant text once", async () => {
    globalThis.fetch = asTestFetch(
      mock(
        async () =>
          new Response(JSON.stringify(RESPONSE_PAYLOAD), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          })
      )
    );

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

  test("drops Netra reasoning items and sends the text instead", async () => {
    const replay = await toResponsesInput([
      { content: "log this receipt", role: "user" },
      {
        content: "Saved.",
        providerContent: NETRA_REASONING,
        role: "assistant",
        thinking: "The user wants to log the receipt.",
      },
      { content: "and the next one", role: "user" },
    ]);

    expect(JSON.stringify(replay)).not.toContain("reasoning.text");
    expect(replay[1]).toEqual({
      content: [{ text: "Saved.", type: "output_text" }],
      role: "assistant",
      type: "message",
    });
  });

  test("drops Netra reasoning items on a tool call turn", async () => {
    const replay = await toResponsesInput([
      { content: "log this receipt", role: "user" },
      {
        content: "Saving it now.",
        providerContent: NETRA_REASONING,
        role: "assistant",
        toolCalls: [
          { arguments: { amount: 45_000 }, id: "call_1", name: "add_expense" },
        ],
      },
      {
        content: "ok",
        name: "add_expense",
        role: "tool",
        toolCallId: "call_1",
      },
    ]);

    expect(JSON.stringify(replay)).not.toContain("reasoning.text");
    expect(itemsCarrying(replay, "Saving it now.")).toHaveLength(1);
    expect(replay.map((item) => readRecord(item).type ?? "user")).toEqual([
      "user",
      "message",
      "function_call",
      "function_call_output",
    ]);
  });

  test("replays Responses items unchanged", async () => {
    const providerContent = [
      { id: "rs_1", summary: [], type: "reasoning" },
      ...RESPONSE_PAYLOAD.output,
    ];

    const replay = await toResponsesInput([
      {
        content: ASSISTANT_TEXT,
        providerContent,
        role: "assistant",
        toolCalls: [
          {
            arguments: { query: "invoice" },
            id: "call_1",
            name: "search_invoices",
          },
        ],
      },
    ]);

    expect(replay.slice(0, 2)).toEqual(providerContent.slice(0, 2));
    expect(itemsCarrying(replay, ASSISTANT_TEXT)).toHaveLength(1);
  });

  test("a DeepSeek turn on Netra followed by an OpenAI turn sends no Netra items", async () => {
    let body = "";
    globalThis.fetch = asTestFetch(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = String(init?.body);

        return new Response(JSON.stringify(RESPONSE_PAYLOAD), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      })
    );

    await generateOpenAIResponsesChat({
      apiKey: "sk-test",
      input: {
        messages: [
          { content: "17 * 23?", role: "user" },
          {
            content: "391.",
            providerContent: NETRA_REASONING,
            role: "assistant",
          },
          { content: "add 9", role: "user" },
        ],
        system: "s",
      },
      model: "gpt-5.4",
      stream: false,
    });

    expect(body).not.toContain("reasoning.text");
    expect(body).toContain("391.");
  });

  test("Netra gets only reasoning_details items after an OpenAI turn", async () => {
    const messages = await toOpenAIMessages(
      "s",
      [
        { content: "invoices", role: "user" },
        {
          content: ASSISTANT_TEXT,
          providerContent: [
            { id: "rs_1", summary: [], type: "reasoning" },
            RESPONSE_PAYLOAD.output[0],
          ],
          role: "assistant",
          thinking: "Look up the invoices.",
        },
        {
          content: "Done.",
          providerContent: NETRA_REASONING,
          role: "assistant",
          thinking: "The user wants to log the receipt.",
        },
      ],
      "netra"
    );

    expect(readRecord(messages[2]).reasoning_details).toBeUndefined();
    expect(readRecord(messages[2]).reasoning_content).toBe(
      "Look up the invoices."
    );
    expect(readRecord(messages[3]).reasoning_details).toEqual(NETRA_REASONING);
  });

  test("sends store false", async () => {
    let body: ResponsesRequestBody = {};
    globalThis.fetch = asTestFetch(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        // SAFETY: The provider serializes this request body and the test checks its known fixture shape.
        body = JSON.parse(String(init?.body)) as ResponsesRequestBody;

        return new Response(JSON.stringify(RESPONSE_PAYLOAD), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      })
    );

    await generateOpenAIResponsesChat({
      apiKey: "sk-test",
      input: { messages: [{ content: "hi", role: "user" }], system: "s" },
      model: "gpt-5.4",
      stream: false,
    });

    expect(body.store).toBe(false);
  });
});
