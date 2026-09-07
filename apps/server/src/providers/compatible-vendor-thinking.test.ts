import { afterEach, describe, expect, mock, test } from "bun:test";
import { CEREBRAS_CHAT_BASE_URL } from "./cerebras";
import { compatibleModelSupportsThinking } from "./compatible-models";
import { FIREWORKS_INFERENCE_BASE_URL } from "./fireworks";
import { createOpenAICompatibleProvider } from "./openai-compatible";

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

const VENDORS = [
  {
    baseUrl: CEREBRAS_CHAT_BASE_URL,
    displayName: "Cerebras",
    model: "gpt-oss-120b",
    name: "cerebras",
  },
  {
    baseUrl: FIREWORKS_INFERENCE_BASE_URL,
    displayName: "Fireworks",
    model: "accounts/fireworks/models/gpt-oss-120b",
    name: "fireworks",
  },
] as const;

function createVendorProvider(
  vendor: (typeof VENDORS)[number],
  supportsThinking: boolean
) {
  return createOpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl: vendor.baseUrl,
    displayName: vendor.displayName,
    model: vendor.model,
    providerName: vendor.name,
    supportsThinking: compatibleModelSupportsThinking(vendor.model, [
      { id: vendor.model, supportsThinking },
    ]),
  });
}

for (const vendor of VENDORS) {
  describe(`${vendor.displayName} provider`, () => {
    test("sends reasoning_effort only when the model supports thinking", async () => {
      const fetchMock = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(String(input)).toBe(`${vendor.baseUrl}/chat/completions`);
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            reasoning_effort?: string;
            reasoning?: { effort?: string };
          };
          expect(body.reasoning_effort).toBe("high");
          expect(body.reasoning).toEqual({ effort: "high" });
          return Response.json({
            choices: [{ message: { content: "Answer", reasoning: "Plan" } }],
          });
        }
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await createVendorProvider(vendor, true).generateChat({
        messages: [{ content: "Think then answer", role: "user" }],
        providerOptions: { thinking: { effort: "high", enabled: true } },
        system: "You are helpful.",
      });

      expect(result.assistantMessage.thinking).toBe("Plan");
    });

    test("omits reasoning_effort when the model does not support thinking", async () => {
      const fetchMock = mock(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            reasoning_effort?: unknown;
          };
          expect(body.reasoning_effort).toBeUndefined();
          return Response.json({
            choices: [{ message: { content: "Answer" } }],
          });
        }
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await createVendorProvider(vendor, false).generateChat({
        messages: [{ content: "Answer", role: "user" }],
        providerOptions: { thinking: { effort: "high", enabled: true } },
        system: "You are helpful.",
      });
    });

    test("streams thinking deltas when upstream sends reasoning content", async () => {
      const fetchMock = mock(
        async () =>
          new Response(
            streamFromChunks([
              'data: {"choices":[{"delta":{"reasoning":"Plan"}}]}\n\n',
              'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
              "data: [DONE]\n\n",
            ]),
            {
              headers: { "content-type": "text/event-stream" },
              status: 200,
            }
          )
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const thinkingChunks: string[] = [];
      const result = await createVendorProvider(vendor, true).streamChat(
        {
          messages: [{ content: "Think then answer", role: "user" }],
          providerOptions: { thinking: { effort: "medium", enabled: true } },
          system: "You are helpful.",
        },
        {
          onChunk: () => {},
          onThinking: (delta) => thinkingChunks.push(delta),
        }
      );

      expect(thinkingChunks.join("")).toBe("Plan");
      expect(result.assistantMessage.thinking).toBe("Plan");
      expect(result.content).toBe("Answer");
    });
  });
}
