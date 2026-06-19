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
      };
      expect(body.reasoning).toEqual({ effort: "high" });
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
  });

  test("omits reasoning config when the model does not support thinking", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning?: unknown;
      };
      expect(body.reasoning).toBeUndefined();
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
