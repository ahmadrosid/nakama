import { describe, expect, mock, test } from "bun:test";
import { createOpenRouterProvider } from "./index";

function chatCompletionResponse(
  content: string,
  options: { toolCalls?: unknown[]; reasoning?: string } = {},
) {
  return JSON.stringify({
    id: "gen-test",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "anthropic/claude-sonnet-4-6",
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content,
          ...(options.reasoning ? { reasoning: options.reasoning } : {}),
          ...(options.toolCalls ? { tool_calls: options.toolCalls } : {}),
        },
      },
    ],
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
    id: "chunk-1",
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model: "anthropic/claude-sonnet-4-6",
    choices: [{ index: 0, delta, finish_reason: null }],
  })}\r\n\r\n`;
}

describe("createOpenRouterProvider", () => {
  test("calls OpenRouter chat completions via SDK", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toContain("/chat/completions");
      const headers = request.headers;
      expect(headers.get("Authorization")).toBe("Bearer sk-or-v1-test");
      expect(headers.get("HTTP-Referer")).toBe("https://github.com/ahmadrosid/nakama");
      expect(headers.get("X-OpenRouter-Title")).toBe("Nakama");

      return new Response(chatCompletionResponse("Hello from OpenRouter"), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      model: "anthropic/claude-sonnet-4-6",
      fetcher: fetchMock as typeof fetch,
    });

    const result = await provider.generateText({
      system: "You are helpful.",
      prompt: "Say hi",
      format: "text",
    });

    expect(result.content).toBe("Hello from OpenRouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returns tool calls from generateChat", async () => {
    const fetchMock = mock(async () => {
      return new Response(
        chatCompletionResponse("", {
          toolCalls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "write_file", arguments: '{"path":"a.txt"}' },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Create a file" }],
      tools: [
        {
          name: "write_file",
          description: "Write a file",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        name: "write_file",
        arguments: { path: "a.txt" },
      },
    ]);
  });

  test("sends reasoning config when thinking is enabled", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = (await request.json()) as {
        reasoning?: { effort?: string; summary?: string };
      };

      expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });

      return new Response(chatCompletionResponse("Answer", { reasoning: "Plan" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Think, then answer" }],
      providerOptions: {
        thinking: { enabled: true, effort: "high" },
      },
    });

    expect(result.content).toBe("Answer");
    expect(result.assistantMessage.thinking).toBe("Plan");
  });

  test("omits reasoning when custom model disables thinking", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = (await request.json()) as { reasoning?: unknown };

      expect(body.reasoning).toBeUndefined();

      return new Response(chatCompletionResponse("Answer"), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      model: "anthropic/claude-sonnet-4-6",
      customModels: [{ id: "anthropic/claude-sonnet-4-6", supportsThinking: false }],
      fetcher: fetchMock as typeof fetch,
    });

    await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Think, then answer" }],
      providerOptions: {
        thinking: { enabled: true, effort: "high" },
      },
    });
  });

  test("omits reasoning for models that do not support thinking", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = (await request.json()) as { reasoning?: unknown; model?: string };

      expect(body.model).toBe("meta-llama/llama-4-maverick");
      expect(body.reasoning).toBeUndefined();

      return new Response(chatCompletionResponse("Answer"), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      model: "meta-llama/llama-4-maverick",
      fetcher: fetchMock as typeof fetch,
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hello" }],
      providerOptions: {
        thinking: { enabled: true, effort: "high" },
      },
    });

    expect(result.content).toBe("Answer");
  });

  test("streams reasoning deltas when thinking is enabled", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = (await request.json()) as { stream?: boolean; reasoning?: unknown };

      expect(body.stream).toBe(true);
      expect(body.reasoning).toEqual({ effort: "medium", summary: "auto" });

      return new Response(
        streamFromChunks([
          streamChunk({ reasoning: "Plan" }),
          streamChunk({ content: "Hi" }),
          "data:[DONE]\r\n\r\n",
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    });

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    const chunks: string[] = [];
    const thinking: string[] = [];
    const result = await provider.streamChat(
      {
        system: "You are helpful.",
        messages: [{ role: "user", content: "Think, then answer" }],
        providerOptions: {
          thinking: { enabled: true, effort: "medium" },
        },
      },
      {
        onChunk: (delta) => chunks.push(delta),
        onThinking: (delta) => thinking.push(delta),
      },
    );

    expect(result.content).toBe("Hi");
    expect(result.assistantMessage.thinking).toBe("Plan");
    expect(chunks).toEqual(["Hi"]);
    expect(thinking).toEqual(["Plan"]);
  });

  test("throws on empty generateText response", async () => {
    const fetchMock = mock(async () => {
      return new Response(chatCompletionResponse("   "), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    await expect(
      provider.generateText({
        system: "You are helpful.",
        prompt: "Say hi",
        format: "text",
      }),
    ).rejects.toThrow("OpenRouter returned an empty response.");
  });
});
