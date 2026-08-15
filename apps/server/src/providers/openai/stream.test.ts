import { afterEach, describe, expect, mock, test } from "bun:test";
import { createOpenAIProvider } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

describe("OpenAI provider streaming", () => {
  test("streams chat completion chunks", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          streamFromChunks([
            'data:{"choices":[{"delta":{"content":"Hel"}}]}\r\n\r\n',
            'data:{"choices":[{"delta":{"content":"lo"}}]}\r\n\r\n',
            "data:[DONE]\r\n\r\n",
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        )
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    const chunks: string[] = [];
    const result = await provider.streamChat(
      {
        messages: [{ content: "Say hello", role: "user" }],
        system: "You are helpful.",
      },
      {
        onChunk: (delta) => chunks.push(delta),
      }
    );

    expect(result.content).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const streamInit = fetchMock.mock.calls[0]?.[1] as
      | (RequestInit & { idleTimeout?: number })
      | undefined;
    expect(streamInit?.idleTimeout).toBe(0);
  });

  test("streams responses api text and thinking", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api.openai.com/v1/responses");

      return new Response(
        streamFromChunks([
          'event: response.output_text.delta\r\ndata:{"type":"response.output_text.delta","delta":"Hi"}\r\n\r\n',
          'data:{"type":"response.reasoning_summary_text.delta","delta":"Plan"}\r\n\r\n',
          'data:{"type":"response.output_item.done","item":{"id":"msg_1","type":"message","content":[{"type":"output_text","text":"Hi"}]}}\r\n\r\n',
          "data:[DONE]\r\n\r\n",
        ]),
        { headers: { "Content-Type": "text/event-stream" }, status: 200 }
      );
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    const chunks: string[] = [];
    const thinking: string[] = [];
    const result = await provider.streamChat(
      {
        messages: [{ content: "Think, then answer", role: "user" }],
        providerOptions: {
          thinking: { effort: "medium", enabled: true },
        },
        system: "You are helpful.",
      },
      {
        onChunk: (delta) => chunks.push(delta),
        onThinking: (delta) => thinking.push(delta),
      }
    );

    expect(result.content).toBe("Hi");
    expect(result.assistantMessage.thinking).toBe("Plan");
    expect(chunks).toEqual(["Hi"]);
    expect(thinking).toEqual(["Plan"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("streams chat completion chunks when thinking is enabled for an unsupported model", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api.openai.com/v1/chat/completions");

      return new Response(
        streamFromChunks([
          'data:{"choices":[{"delta":{"content":"Hi"}}]}\r\n\r\n',
          "data:[DONE]\r\n\r\n",
        ]),
        { headers: { "Content-Type": "text/event-stream" }, status: 200 }
      );
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });

    const result = await provider.streamChat(
      {
        messages: [{ content: "Say hi", role: "user" }],
        providerOptions: {
          thinking: { effort: "medium", enabled: true },
        },
        system: "You are helpful.",
      },
      {
        onChunk: () => {},
      }
    );

    expect(result.content).toBe("Hi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("omits reasoning from responses api for unsupported models", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/responses");
        const body = JSON.parse(String(init?.body)) as { reasoning?: unknown };
        expect(body.reasoning).toBeUndefined();

        return new Response(
          streamFromChunks([
            'event: response.output_text.delta\r\ndata:{"type":"response.output_text.delta","delta":"Hi"}\r\n\r\n',
            'data:{"type":"response.output_item.done","item":{"id":"msg_1","type":"message","content":[{"type":"output_text","text":"Hi"}]}}\r\n\r\n',
            "data:[DONE]\r\n\r\n",
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        );
      }
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });

    const result = await provider.streamChat(
      {
        messages: [{ content: "Search the web", role: "user" }],
        providerOptions: {
          thinking: { effort: "medium", enabled: true },
          webSearch: true,
        },
        system: "You are helpful.",
      },
      {
        onChunk: () => {},
      }
    );

    expect(result.content).toBe("Hi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  const deepseekProvider = () =>
    createOpenAIProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      providerName: "deepseek",
    });

  const sseResponse = (...deltas: Record<string, unknown>[]) =>
    new Response(
      streamFromChunks([
        ...deltas.map(
          (delta) => `data:${JSON.stringify({ choices: [{ delta }] })}\r\n\r\n`
        ),
        "data:[DONE]\r\n\r\n",
      ]),
      { headers: { "Content-Type": "text/event-stream" }, status: 200 }
    );

  const mockFetchBodies = (
    handler: (call: number, body: Record<string, unknown>) => Response
  ) => {
    const bodies: Array<Record<string, unknown>> = [];
    let callCount = 0;
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        callCount += 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        bodies.push(body);
        return handler(callCount, body);
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return { bodies, fetchMock };
  };

  test("deepseek stream tool turn re-sends reasoning_content on follow-up", async () => {
    const { bodies, fetchMock } = mockFetchBodies((call) =>
      call === 1
        ? sseResponse(
            { reasoning_content: "Need lookup" },
            {
              tool_calls: [
                {
                  function: { arguments: '{"q":"x"}', name: "lookup" },
                  id: "call_1",
                  index: 0,
                  type: "function",
                },
              ],
            }
          )
        : sseResponse({ content: "Done" })
    );

    const provider = deepseekProvider();
    const request = {
      providerOptions: { thinking: { effort: "high" as const, enabled: true } },
      system: "You are helpful.",
      tools: [
        {
          description: "Lookup",
          name: "lookup",
          parameters: {
            properties: { q: { type: "string" } },
            required: ["q"],
            type: "object",
          },
        },
      ],
    };

    const first = await provider.streamChat(
      { messages: [{ content: "Look it up", role: "user" }], ...request },
      { onChunk: () => {} }
    );

    expect(first.assistantMessage.thinking).toBe("Need lookup");
    expect(first.toolCalls).toEqual([
      { arguments: { q: "x" }, id: "call_1", name: "lookup" },
    ]);
    expect(bodies[0]?.thinking).toEqual({ type: "enabled" });
    expect(bodies[0]?.reasoning_effort).toBe("high");

    const second = await provider.streamChat(
      {
        messages: [
          { content: "Look it up", role: "user" },
          first.assistantMessage,
          {
            content: "value",
            name: "lookup",
            role: "tool",
            toolCallId: "call_1",
          },
        ],
        ...request,
      },
      { onChunk: () => {} }
    );

    expect(second.content).toBe("Done");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const followUpMessages = (bodies[1]?.messages ?? []) as Array<
      Record<string, unknown>
    >;
    const assistantWithTools = followUpMessages.find(
      (message) => message.role === "assistant" && message.tool_calls
    );
    expect(assistantWithTools?.reasoning_content).toBe("Need lookup");
    expect(assistantWithTools?.tool_calls).toBeDefined();
  });

  test("deepseek omits thinking body when thinking is disabled", async () => {
    mockFetchBodies((_call, body) => {
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.reasoning_effort).toBeUndefined();
      return sseResponse({ content: "Hi" });
    });

    const result = await deepseekProvider().streamChat(
      {
        messages: [{ content: "Say hi", role: "user" }],
        providerOptions: { thinking: { enabled: false } },
        system: "You are helpful.",
      },
      { onChunk: () => {} }
    );

    expect(result.content).toBe("Hi");
  });

  test("captures reasoning_content from non-streaming deepseek responses", async () => {
    const fetchMock = mock(async () =>
      Response.json({
        choices: [
          { message: { content: "Answer", reasoning_content: "Plan" } },
        ],
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await deepseekProvider().generateChat({
      messages: [{ content: "Think", role: "user" }],
      providerOptions: { thinking: { effort: "medium", enabled: true } },
      system: "You are helpful.",
    });

    expect(result.content).toBe("Answer");
    expect(result.assistantMessage.thinking).toBe("Plan");
  });
});
