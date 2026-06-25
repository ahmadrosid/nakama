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
        content: { role: "model", parts },
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

      return new Response(generateContentResponse({ text: "Hello from Gemini" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await withMockFetch(fetchMock as typeof fetch, async () => {
      const provider = createGeminiProvider({
        apiKey: "AIzaTest",
        model: "gemini-2.5-flash",
      });

      expect(provider.name).toBe("gemini");

      const result = await provider.generateText({
        system: "You are helpful.",
        prompt: "Say hi",
        format: "text",
      });

      expect(result.content).toBe("Hello from Gemini");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  test("generateChat returns tool calls", async () => {
    const fetchMock = mock(async () => {
      return new Response(
        generateContentResponse({
          functionCalls: [
            { id: "fc1", name: "write_file", args: { path: "a.txt" } },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await withMockFetch(fetchMock as typeof fetch, async () => {
      const provider = createGeminiProvider({ apiKey: "AIzaTest" });

      const result = await provider.generateChat({
        system: "system",
        messages: [{ role: "user", content: "write a file" }],
        tools: [
          {
            name: "write_file",
            description: "Write a file",
            parameters: { type: "object", properties: {} },
          },
        ],
      });

      expect(result.toolCalls).toEqual([
        { id: "fc1", name: "write_file", arguments: { path: "a.txt" } },
      ]);
      expect(result.usage).toBeUndefined();
    });
  });

  test("captures API-reported usage", async () => {
    const fetchMock = mock(async () => {
      return new Response(
        generateContentResponse({
          text: "Answer",
          usageMetadata: {
            promptTokenCount: 70,
            candidatesTokenCount: 20,
            totalTokenCount: 90,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await withMockFetch(fetchMock as typeof fetch, async () => {
      const provider = createGeminiProvider({ apiKey: "AIzaTest" });
      const result = await provider.generateChat({
        system: "system",
        messages: [{ role: "user", content: "hi" }],
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
            candidates: [{ content: { parts: [{ text: "Plan", thought: true }] } }],
          }),
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Hi" }] } }],
          }),
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    });

    await withMockFetch(fetchMock as typeof fetch, async () => {
      const provider = createGeminiProvider({ apiKey: "AIzaTest" });

      const chunks: string[] = [];
      const thinking: string[] = [];

      const result = await provider.streamChat(
        {
          system: "system",
          messages: [{ role: "user", content: "hi" }],
          providerOptions: { thinking: { enabled: true, effort: "medium" } },
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
  });
});
