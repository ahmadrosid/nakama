import { afterEach, describe, expect, mock, test } from "bun:test";
import { createCerebrasProvider } from "./index";

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

describe("Cerebras provider", () => {
  test("sends reasoning_effort only when the model supports thinking", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.cerebras.ai/v1/chat/completions");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning_effort?: string;
        reasoning?: unknown;
      };
      expect(body.reasoning_effort).toBe("high");
      expect(body.reasoning).toBeUndefined();
      return Response.json({
        choices: [{ message: { content: "Answer", reasoning: "Plan" } }],
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createCerebrasProvider({
      apiKey: "test-key",
      model: "gpt-oss-120b",
      customModels: [{ id: "gpt-oss-120b", supportsThinking: true }],
    });

    const result = await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Think then answer" }],
      providerOptions: { thinking: { enabled: true, effort: "high" } },
    });

    expect(result.assistantMessage.thinking).toBe("Plan");
  });

  test("omits reasoning_effort when the model does not support thinking", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning_effort?: unknown;
      };
      expect(body.reasoning_effort).toBeUndefined();
      return Response.json({
        choices: [{ message: { content: "Answer" } }],
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createCerebrasProvider({
      apiKey: "test-key",
      model: "gpt-oss-120b",
      customModels: [{ id: "gpt-oss-120b", supportsThinking: false }],
    });

    await provider.generateChat({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Answer" }],
      providerOptions: { thinking: { enabled: true, effort: "high" } },
    });
  });

  test("streams thinking deltas when upstream sends reasoning content", async () => {
    const fetchMock = mock(async () =>
      new Response(
        streamFromChunks([
          'data: {"choices":[{"delta":{"reasoning":"Plan"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      ),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createCerebrasProvider({
      apiKey: "test-key",
      model: "gpt-oss-120b",
      customModels: [{ id: "gpt-oss-120b", supportsThinking: true }],
    });

    const thinkingChunks: string[] = [];

    const result = await provider.streamChat(
      {
        system: "You are helpful.",
        messages: [{ role: "user", content: "Think then answer" }],
        providerOptions: { thinking: { enabled: true, effort: "medium" } },
      },
      {
        onChunk: () => {},
        onThinking: (delta) => thinkingChunks.push(delta),
      },
    );

    expect(thinkingChunks.join("")).toBe("Plan");
    expect(result.assistantMessage.thinking).toBe("Plan");
    expect(result.content).toBe("Answer");
  });
});
