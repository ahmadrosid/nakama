import { afterEach, describe, expect, mock, test } from "bun:test";
import { createOpenAICompatibleProvider } from "./openai-compatible";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const RESPONSE_PAYLOAD = {
  output: [
    {
      content: [{ text: "ok", type: "output_text" }],
      id: "msg_1",
      role: "assistant",
      status: "completed",
      type: "message",
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1 },
};

function stubFetch(payload: unknown) {
  const calls: Array<{ body: Record<string, unknown>; url: string }> = [];

  globalThis.fetch = mock(async (url: unknown, init?: RequestInit) => {
    calls.push({
      body: JSON.parse(String(init?.body ?? "{}")),
      url: String(url),
    });

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }) as unknown as typeof fetch;

  return calls;
}

function stubSseFetch(events: unknown[]) {
  const calls: Array<{ body: Record<string, unknown>; url: string }> = [];
  const sse = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");

  globalThis.fetch = mock(async (url: unknown, init?: RequestInit) => {
    calls.push({
      body: JSON.parse(String(init?.body ?? "{}")),
      url: String(url),
    });

    return new Response(sse, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    });
  }) as unknown as typeof fetch;

  return calls;
}

const CHAT_INPUT = {
  messages: [{ content: "hi", role: "user" as const }],
  providerOptions: { thinking: { effort: "medium" as const, enabled: true } },
  system: "s",
  tools: [
    {
      description: "d",
      name: "search",
      parameters: { type: "object" as const },
    },
  ],
};

describe("openai-compatible wire API", () => {
  test("wireApi responses posts to /responses and keeps reasoning next to tools", async () => {
    const calls = stubFetch(RESPONSE_PAYLOAD);
    const provider = createOpenAICompatibleProvider({
      apiKey: "k",
      baseUrl: "https://endpoint.test/v1",
      displayName: "Endpoint",
      model: "gpt-5.4",
      supportsThinking: true,
      wireApi: "responses",
    });

    await provider.generateChat(CHAT_INPUT);

    expect(calls[0]?.url).toBe("https://endpoint.test/v1/responses");
    // chat/completions rejects this pair on gpt-5.4+, so the provider forces
    // reasoning_effort to "none" there. The Responses API accepts both.
    expect(calls[0]?.body.reasoning).toEqual({
      effort: "medium",
      summary: "auto",
    });
    expect(calls[0]?.body.reasoning_effort).toBeUndefined();
  });

  test("wireApi responses streams from the same endpoint", async () => {
    const calls = stubSseFetch([
      { delta: "ok", type: "response.output_text.delta" },
      {
        item: {
          content: [{ text: "ok", type: "output_text" }],
          role: "assistant",
          type: "message",
        },
        type: "response.output_item.done",
      },
    ]);
    const provider = createOpenAICompatibleProvider({
      apiKey: "k",
      baseUrl: "https://endpoint.test/v1",
      displayName: "Endpoint",
      model: "gpt-5.4",
      supportsThinking: true,
      wireApi: "responses",
    });

    await provider.streamChat(CHAT_INPUT, {
      onChunk: () => undefined,
    });

    expect(calls[0]?.url).toBe("https://endpoint.test/v1/responses");
    expect(calls[0]?.body.stream).toBe(true);
  });

  test("without wireApi the endpoint stays on chat/completions", async () => {
    const calls = stubFetch({
      choices: [{ message: { content: "ok", role: "assistant" } }],
      usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
    });
    const provider = createOpenAICompatibleProvider({
      apiKey: "k",
      baseUrl: "https://endpoint.test/v1",
      displayName: "Endpoint",
      model: "gpt-5.4",
      supportsThinking: true,
    });

    await provider.generateChat(CHAT_INPUT);

    expect(calls[0]?.url).toContain("/chat/completions");
    expect(calls[0]?.body.reasoning).toBeUndefined();
  });
});
