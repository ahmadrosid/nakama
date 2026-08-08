import { describe, expect, mock, test } from "bun:test";
import { createOpenRouterProvider } from "./index";

function chatCompletionResponse(
  content: string,
  options: { toolCalls?: unknown[]; reasoning?: string } = {}
) {
  return JSON.stringify({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: {
          content,
          role: "assistant",
          ...(options.reasoning ? { reasoning: options.reasoning } : {}),
          ...(options.toolCalls ? { tool_calls: options.toolCalls } : {}),
        },
      },
    ],
    created: 1_700_000_000,
    id: "gen-test",
    model: "anthropic/claude-sonnet-4-6",
    object: "chat.completion",
    system_fingerprint: null,
  });
}

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

function streamChunk(delta: Record<string, unknown>): string {
  return `data:${JSON.stringify({
    choices: [{ delta, finish_reason: null, index: 0 }],
    created: 1_700_000_000,
    id: "chunk-1",
    model: "anthropic/claude-sonnet-4-6",
    object: "chat.completion.chunk",
  })}\r\n\r\n`;
}

describe("createOpenRouterProvider", () => {
  test("calls OpenRouter chat completions via SDK", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        expect(request.url).toContain("/chat/completions");
        const headers = request.headers;
        expect(headers.get("Authorization")).toBe("Bearer sk-or-v1-test");
        expect(headers.get("HTTP-Referer")).toBe(
          "https://github.com/ahmadrosid/nakama"
        );
        expect(headers.get("X-OpenRouter-Title")).toBe("Nakama");

        return new Response(chatCompletionResponse("Hello from OpenRouter"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "anthropic/claude-sonnet-4-6",
    });

    const result = await provider.generateText({
      format: "text",
      prompt: "Say hi",
      system: "You are helpful.",
    });

    expect(result.content).toBe("Hello from OpenRouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returns tool calls from generateChat", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          chatCompletionResponse("", {
            toolCalls: [
              {
                function: { arguments: '{"path":"a.txt"}', name: "write_file" },
                id: "call_1",
                type: "function",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Create a file", role: "user" }],
      system: "You are helpful.",
      tools: [
        {
          description: "Write a file",
          name: "write_file",
          parameters: { properties: {}, type: "object" },
        },
      ],
    });

    expect(result.toolCalls).toEqual([
      {
        arguments: { path: "a.txt" },
        id: "call_1",
        name: "write_file",
      },
    ]);
  });

  test("sends reasoning config when thinking is enabled", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as {
          reasoning?: { effort?: string; summary?: string };
        };

        expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });

        return new Response(
          chatCompletionResponse("Answer", { reasoning: "Plan" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Think, then answer", role: "user" }],
      providerOptions: {
        thinking: { effort: "high", enabled: true },
      },
      system: "You are helpful.",
    });

    expect(result.content).toBe("Answer");
    expect(result.assistantMessage.thinking).toBe("Plan");
  });

  test("omits reasoning when custom model disables thinking", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as { reasoning?: unknown };

        expect(body.reasoning).toBeUndefined();

        return new Response(chatCompletionResponse("Answer"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      customModels: [
        { id: "anthropic/claude-sonnet-4-6", supportsThinking: false },
      ],
      fetcher: fetchMock as typeof fetch,
      model: "anthropic/claude-sonnet-4-6",
    });

    await provider.generateChat({
      messages: [{ content: "Think, then answer", role: "user" }],
      providerOptions: {
        thinking: { effort: "high", enabled: true },
      },
      system: "You are helpful.",
    });
  });

  test("omits reasoning for models that do not support thinking", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as {
          reasoning?: unknown;
          model?: string;
        };

        expect(body.model).toBe("meta-llama/llama-4-maverick");
        expect(body.reasoning).toBeUndefined();

        return new Response(chatCompletionResponse("Answer"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "meta-llama/llama-4-maverick",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hello", role: "user" }],
      providerOptions: {
        thinking: { effort: "high", enabled: true },
      },
      system: "You are helpful.",
    });

    expect(result.content).toBe("Answer");
  });

  test("streams reasoning deltas when thinking is enabled", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as {
          stream?: boolean;
          reasoning?: unknown;
        };

        expect(body.stream).toBe(true);
        expect(body.reasoning).toEqual({ effort: "medium", summary: "auto" });

        return new Response(
          streamFromChunks([
            streamChunk({ reasoning: "Plan" }),
            streamChunk({ content: "Hi" }),
            "data:[DONE]\r\n\r\n",
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        );
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
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
  });

  test("throws on empty generateText response", async () => {
    const fetchMock = mock(
      async () =>
        new Response(chatCompletionResponse("   "), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    await expect(
      provider.generateText({
        format: "text",
        prompt: "Say hi",
        system: "You are helpful.",
      })
    ).rejects.toThrow("OpenRouter returned an empty response.");
  });
});
