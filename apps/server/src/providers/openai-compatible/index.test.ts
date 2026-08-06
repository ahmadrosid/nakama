import { afterEach, describe, expect, mock, test } from "bun:test";
import { createOpenAICompatibleProvider } from "./index";

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

describe("OpenAI-compatible provider", () => {
  test("sends reasoning config only when the model supports thinking", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.example.com/v1/chat/completions");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning?: { effort?: string };
        reasoning_effort?: string;
      };
      expect(body.reasoning).toEqual({ effort: "high" });
      expect(body.reasoning_effort).toBe("high");
      return Response.json({
        choices: [{ message: { content: "Answer", reasoning: "Plan" } }],
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      model: "qwen3.6-35b",
      displayName: "NetraRuntime",
      supportsThinking: true,
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Think then answer" }],
      providerOptions: { thinking: { enabled: true, effort: "high" } },
    });

    expect(result.assistantMessage.thinking).toBe("Plan");
    expect(result.usage).toBeUndefined();
  });

  test("omits reasoning config when the model does not support thinking", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning?: unknown;
        reasoning_effort?: unknown;
      };
      expect(body.reasoning).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
      return Response.json({
        choices: [{ message: { content: "Answer" } }],
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      model: "qwen3.6-7b",
      displayName: "NetraRuntime",
      supportsThinking: false,
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Think then answer" }],
      providerOptions: { thinking: { enabled: true, effort: "high" } },
    });

    expect(result.content).toBe("Answer");
  });

  test("sets reasoning_effort to none for gpt-5.6 tools on chat completions", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning?: unknown;
        reasoning_effort?: string;
        tools?: unknown[];
      };
      expect(body.tools).toHaveLength(1);
      expect(body.reasoning).toBeUndefined();
      expect(body.reasoning_effort).toBe("none");
      return Response.json({
        choices: [{ message: { content: "Answer" } }],
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6-luna",
      displayName: "OpenAI",
      supportsThinking: true,
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Search" }],
      tools: [
        {
          name: "search_files",
          description: "Search files",
          parameters: { type: "object", properties: {} },
        },
      ],
      providerOptions: { thinking: { enabled: true, effort: "high" } },
    });

    expect(result.content).toBe("Answer");
  });

  test("forces reasoning_effort none for gpt-5.6 tools even when thinking is off", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning?: unknown;
        reasoning_effort?: string;
        tools?: unknown[];
      };
      expect(body.tools).toHaveLength(1);
      expect(body.reasoning).toBeUndefined();
      expect(body.reasoning_effort).toBe("none");
      return Response.json({
        choices: [{ message: { content: "Answer" } }],
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6-luna",
      displayName: "OpenAI",
      supportsThinking: true,
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Search" }],
      tools: [
        {
          name: "search_files",
          description: "Search files",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(result.content).toBe("Answer");
  });

  test("keeps reasoning_effort for non-OpenAI models with tools", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning_effort?: string;
        tools?: unknown[];
      };
      expect(body.tools).toHaveLength(1);
      expect(body.reasoning_effort).toBe("high");
      return Response.json({
        choices: [{ message: { content: "Answer" } }],
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      model: "qwen3.6-35b",
      displayName: "NetraRuntime",
      supportsThinking: true,
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Search" }],
      tools: [
        {
          name: "search_files",
          description: "Search files",
          parameters: { type: "object", properties: {} },
        },
      ],
      providerOptions: { thinking: { enabled: true, effort: "high" } },
    });

    expect(result.content).toBe("Answer");
  });

  test("preserves leading spaces in streamed reasoning_content deltas", async () => {
    const fetchMock = mock(async () => {
      return new Response(
        streamFromChunks([
          'data: {"choices":[{"delta":{"reasoning_content":"The"}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning_content":" user"}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning_content":" wants"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "big-pickle",
      displayName: "OpenCode Zen",
      supportsThinking: true,
    });

    const thinking: string[] = [];
    const result = await provider.streamChat(
      {
        system: "You are helpful.",
        messages: [{ role: "user", content: "Think then answer" }],
        providerOptions: { thinking: { enabled: true, effort: "medium" } },
      },
      {
        onChunk: () => {},
        onThinking: (delta) => thinking.push(delta),
      },
    );

    expect(thinking).toEqual(["The", " user", " wants"]);
    expect(result.assistantMessage.thinking).toBe("The user wants");
  });

  test("streams reasoning deltas when thinking is enabled for a supported model", async () => {
    const fetchMock = mock(async () => {
      return new Response(
        streamFromChunks([
          'data: {"choices":[{"delta":{"reasoning":"Plan"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      model: "qwen3.6-35b",
      displayName: "NetraRuntime",
      supportsThinking: true,
    });

    const thinking: string[] = [];
    const chunks: string[] = [];
    const result = await provider.streamChat(
      {
        system: "You are helpful.",
        messages: [{ role: "user", content: "Think then answer" }],
        providerOptions: { thinking: { enabled: true, effort: "medium" } },
      },
      {
        onChunk: (delta) => chunks.push(delta),
        onThinking: (delta) => thinking.push(delta),
      },
    );

    expect(chunks).toEqual(["Hi"]);
    expect(thinking).toEqual(["Plan"]);
    expect(result.assistantMessage.thinking).toBe("Plan");
  });

  test("captures API-reported usage for non-streaming chat", async () => {
    const fetchMock = mock(async () => {
      return Response.json({
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
        },
        choices: [{ message: { content: "Answer" } }],
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      model: "qwen3.6-35b",
      displayName: "NetraRuntime",
      supportsThinking: false,
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    });
  });

  test("captures API-reported usage for streaming chat", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream_options?: { include_usage?: boolean };
      };
      expect(body.stream_options).toEqual({ include_usage: true });

      return new Response(
        streamFromChunks([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          'data: {"usage":{"prompt_tokens":88,"completion_tokens":12,"total_tokens":100},"choices":[]}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      model: "qwen3.6-35b",
      displayName: "NetraRuntime",
      supportsThinking: false,
    });

    const result = await provider.streamChat(
      {
        system: "You are helpful.",
        messages: [{ role: "user", content: "Hi" }],
      },
      { onChunk: () => {} },
    );

    expect(result.usage).toEqual({
      inputTokens: 88,
      outputTokens: 12,
      totalTokens: 100,
    });
  });

  test("surfaces JSON provider errors on stream requests", async () => {
    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "FreeUsageLimitError",
            message: "Rate limit exceeded. Please try again later.",
          },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: "public",
      baseUrl: "https://opencode.ai/zen/v1",
      model: "big-pickle",
      displayName: "OpenCode Zen",
      supportsThinking: false,
    });

    await expect(
      provider.streamChat(
        {
          system: "You are helpful.",
          messages: [{ role: "user", content: "Hi" }],
        },
        { onChunk: () => {} },
      ),
    ).rejects.toThrow(
      "OpenCode Zen request failed (429 FreeUsageLimitError): Rate limit exceeded. Please try again later.",
    );
  });
});
