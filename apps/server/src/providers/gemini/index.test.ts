import { afterEach, describe, expect, mock, test } from "bun:test";
import { createGeminiProvider } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function withMockFetch(fetchMock: typeof fetch, run: () => Promise<void>) {
  globalThis.fetch = fetchMock;
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function generateContentResponse(options: {
  text?: string;
  thinking?: string;
  functionCalls?: unknown[];
  usageMetadata?: Record<string, unknown>;
}) {
  const parts: Array<Record<string, unknown>> = [];

  if (options.thinking) {
    parts.push({ text: options.thinking, thought: true });
  }

  if (options.text) {
    parts.push({ text: options.text });
  }

  for (const call of options.functionCalls ?? []) {
    parts.push({ functionCall: call });
  }

  return JSON.stringify({
    ...(options.usageMetadata ? { usageMetadata: options.usageMetadata } : {}),
    candidates: [
      {
        content: { parts, role: "model" },
        finishReason: "STOP",
      },
    ],
  });
}

function streamFromEvents(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = events.map((event) => `data: ${event}\n\n`).join("");

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

describe("createGeminiProvider", () => {
  test("generateText returns model text", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("gemini-2.5-flash");
      expect(url).toContain("generateContent");

      return new Response(
        generateContentResponse({ text: "Hello from Gemini" }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }
      );
    });

    await withMockFetch(fetchMock as typeof fetch, async () => {
      const provider = createGeminiProvider({
        apiKey: "AIzaTest",
        model: "gemini-2.5-flash",
      });

      const result = await provider.generateText({
        format: "text",
        prompt: "Say hi",
        system: "You are helpful.",
      });

      expect(result.content).toBe("Hello from Gemini");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  test("generateChat returns tool calls", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          generateContentResponse({
            functionCalls: [
              { args: { path: "a.txt" }, id: "fc1", name: "write_file" },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
    );

    await withMockFetch(fetchMock as typeof fetch, async () => {
      const provider = createGeminiProvider({ apiKey: "AIzaTest" });

      const result = await provider.generateChat({
        messages: [{ content: "write a file", role: "user" }],
        system: "system",
        tools: [
          {
            description: "Write a file",
            name: "write_file",
            parameters: { properties: {}, type: "object" },
          },
        ],
      });

      expect(result.toolCalls).toEqual([
        { arguments: { path: "a.txt" }, id: "fc1", name: "write_file" },
      ]);
      expect(result.usage).toBeUndefined();
    });
  });

  test("captures API-reported usage", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          generateContentResponse({
            text: "Answer",
            usageMetadata: {
              candidatesTokenCount: 20,
              promptTokenCount: 70,
              totalTokenCount: 90,
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
    );

    await withMockFetch(fetchMock as typeof fetch, async () => {
      const provider = createGeminiProvider({ apiKey: "AIzaTest" });
      const result = await provider.generateChat({
        messages: [{ content: "hi", role: "user" }],
        system: "system",
      });

      expect(result.usage).toEqual({
        inputTokens: 70,
        outputTokens: 20,
        totalTokens: 90,
      });
    });
  });

  test("streamChat streams text and thinking", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("streamGenerateContent");

      return new Response(
        streamFromEvents([
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: "Plan", thought: true }] } },
            ],
          }),
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Hi" }] } }],
          }),
        ]),
        { headers: { "Content-Type": "text/event-stream" }, status: 200 }
      );
    });

    await withMockFetch(fetchMock as typeof fetch, async () => {
      const provider = createGeminiProvider({ apiKey: "AIzaTest" });

      const chunks: string[] = [];
      const thinking: string[] = [];

      const result = await provider.streamChat(
        {
          messages: [{ content: "hi", role: "user" }],
          providerOptions: { thinking: { effort: "medium", enabled: true } },
          system: "system",
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
  });
});
