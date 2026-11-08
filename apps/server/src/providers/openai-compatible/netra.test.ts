import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type ProviderJsonRecord,
  parseJsonRecord,
  readRecord,
} from "../shared";
import { asTestFetch, streamFromChunks } from "../test-helpers";
import { createOpenAICompatibleProvider } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const netraProvider = (model = "deepseek/deepseek-v4-flash-0731") =>
  createOpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl: "https://api.netraruntime.com/v1",
    displayName: "Netra Runtime",
    model,
    providerName: "netra",
    supportsThinking: true,
  });

const netraStream = (chunks: string[]) =>
  new Response(streamFromChunks(chunks), {
    headers: { "Content-Type": "text/event-stream" },
    status: 200,
  });

describe("Netra Runtime provider", () => {
  test("Netra text generation asks for JSON without an unsupported response format", async () => {
    globalThis.fetch = asTestFetch(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = parseJsonRecord(String(init?.body));
        expect(body.response_format).toBeUndefined();

        return Response.json({
          choices: [{ message: { content: '{"ok":true}' } }],
        });
      })
    );

    const result = await netraProvider().generateText({
      format: "json",
      prompt: "Return JSON",
      system: "Return JSON",
    });

    expect(result.content).toBe('{"ok":true}');
  });

  test("Netra sends one reasoning control and preserves tool continuation", async () => {
    const calls: ProviderJsonRecord[] = [];
    globalThis.fetch = asTestFetch(
      mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://api.netraruntime.com/v1/chat/completions"
        );
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer test-key"
        );
        const body = parseJsonRecord(String(init?.body));
        calls.push(body);

        if (calls.length === 1) {
          return Response.json({
            choices: [
              {
                message: {
                  content: null,
                  reasoning_content: "I need data",
                  reasoning_details: [
                    {
                      data: "opaque",
                      signature: "real",
                      type: "reasoning.encrypted",
                    },
                  ],
                  tool_calls: [
                    {
                      function: { arguments: "{}", name: "lookup" },
                      id: "call_1",
                      type: "function",
                    },
                  ],
                },
              },
            ],
          });
        }

        return Response.json({ choices: [{ message: { content: "Done" } }] });
      })
    );

    const provider = netraProvider();

    const tool = {
      description: "Look up data",
      name: "lookup",
      parameters: { properties: {}, type: "object" },
    };

    const first = await provider.generateChat({
      messages: [{ content: "Find data", role: "user" }],
      providerOptions: { thinking: { effort: "medium", enabled: true } },
      system: "Help",
      tools: [tool],
    });

    expect(calls[0]?.reasoning).toEqual({ effort: "high" });
    expect(calls[0]?.reasoning_effort).toBeUndefined();
    expect(first.assistantMessage.providerContent).toEqual([
      { data: "opaque", signature: "real", type: "reasoning.encrypted" },
    ]);
    expect(first.toolCalls[0]?.id).toBe("call_1");

    await provider.generateChat({
      messages: [
        { content: "Find data", role: "user" },
        first.assistantMessage,
        { content: "42", name: "lookup", role: "tool", toolCallId: "call_1" },
      ],
      providerOptions: { thinking: { enabled: false } },
      system: "Help",
      tools: [tool],
    });
    expect(calls[1]?.reasoning).toEqual({ enabled: false });
    const messages = Array.isArray(calls[1]?.messages) ? calls[1].messages : [];
    expect(readRecord(messages[2]).reasoning_details).toEqual([
      { data: "opaque", signature: "real", type: "reasoning.encrypted" },
    ]);
    expect(readRecord(messages[3]).tool_call_id).toBe("call_1");
  });

  test("Netra rejects a terminal stream error after partial text", async () => {
    globalThis.fetch = asTestFetch(
      mock(async () =>
        netraStream([
          'data: {"choices":[{"delta":{"content":"Part"}}]}\n\n',
          'event: error\ndata: {"error":{"message":"balance exhausted"}}\n\n',
          "data: [DONE]\n\n",
        ])
      )
    );
    const provider = netraProvider();
    const chunks: string[] = [];
    await expect(
      provider.streamChat(
        { messages: [{ content: "Hi", role: "user" }], system: "Help" },
        { onChunk: (chunk) => chunks.push(chunk) }
      )
    ).rejects.toThrow("balance exhausted");
    expect(chunks).toEqual(["Part"]);
  });

  test.each([
    [
      '{"tool_calls":[{"index":0,"id":"c1","function":{"name":"a","arguments":"{"}}]}',
      1,
    ],
    ["{}", 0],
  ])(
    "Netra marks a reply cut off at the output limit",
    async (delta, calls) => {
      globalThis.fetch = asTestFetch(
        mock(async () =>
          netraStream([
            `data: {"choices":[{"delta":${delta},"finish_reason":"length"}]}\n\n`,
            "data: [DONE]\n\n",
          ])
        )
      );

      const result = await netraProvider().streamChat(
        { messages: [{ content: "Hi", role: "user" }], system: "Help" },
        { onChunk: () => {} }
      );

      expect(result.truncated).toBe(true);
      expect(result.toolCalls).toHaveLength(calls);
    }
  );

  test("Netra rejects a stream that closes before DONE", async () => {
    globalThis.fetch = asTestFetch(
      mock(async () =>
        netraStream(['data: {"choices":[{"delta":{"content":"Part"}}]}\n\n'])
      )
    );
    const provider = netraProvider();
    await expect(
      provider.streamChat(
        { messages: [{ content: "Hi", role: "user" }], system: "Help" },
        { onChunk: () => {} }
      )
    ).rejects.toThrow("before [DONE]");
  });

  test("Netra passes max through and lowers xhigh to high", async () => {
    const efforts: unknown[] = [];
    globalThis.fetch = asTestFetch(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        efforts.push(parseJsonRecord(String(init?.body)).reasoning);

        return Response.json({ choices: [{ message: { content: "Hi" } }] });
      })
    );

    const provider = netraProvider("deepseek/deepseek-v4.1-flash");

    for (const effort of ["max", "xhigh", "medium", "low"] as const) {
      await provider.generateChat({
        messages: [{ content: "Hi", role: "user" }],
        providerOptions: { thinking: { effort, enabled: true } },
        system: "Help",
      });
    }

    expect(efforts).toEqual([
      { effort: "max" },
      { effort: "high" },
      { effort: "high" },
      { effort: "low" },
    ]);
  });
});
