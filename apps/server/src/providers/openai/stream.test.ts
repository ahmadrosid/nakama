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
});
