import { describe, expect, mock, test } from "bun:test";
import type { ProviderJsonRecord } from "../shared";
import { asTestFetch, streamFromChunks } from "../test-helpers";
import { createOpenRouterProvider } from "./index";

function chatCompletionResponse(
  content: string | ProviderJsonRecord[],
  options: { toolCalls?: unknown[]; reasoning?: string } = {}
) {
  const message = { content, role: "assistant" };

  if (options.reasoning) {
    Object.assign(message, { reasoning: options.reasoning });
  }

  if (options.toolCalls) {
    Object.assign(message, { tool_calls: options.toolCalls });
  }

  return JSON.stringify({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message,
      },
    ],
    created: 1_700_000_000,
    id: "gen-test",
    model: "anthropic/claude-sonnet-4-6",
    object: "chat.completion",
    system_fingerprint: null,
  });
}

function streamChunk<ErrorValue>(
  delta: ProviderJsonRecord,
  error?: ErrorValue
): string {
  return `data:${JSON.stringify({
    choices: [{ delta, finish_reason: null, index: 0 }],
    created: 1_700_000_000,
    error,
    id: "chunk-1",
    model: "anthropic/claude-sonnet-4-6",
    object: "chat.completion.chunk",
  })}\r\n\r\n`;
}

function streamError<ErrorValue>(error: ErrorValue): string {
  return `data:${JSON.stringify({
    choices: [],
    created: 1_700_000_000,
    error,
    id: "chunk-error",
    model: "anthropic/claude-sonnet-4-6",
    object: "chat.completion.chunk",
  })}\r\n\r\n`;
}

describe("createOpenRouterProvider", () => {
  test("sends reasoning config when thinking is enabled", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);

        // SAFETY: The provider serializes this request body and the test checks its known fixture shape.
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
      fetcher: asTestFetch(fetchMock),
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

        // SAFETY: The provider serializes this request body and the test checks its known fixture shape.
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
      fetcher: asTestFetch(fetchMock),
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

        // SAFETY: The provider serializes this request body and the test checks its known fixture shape.
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
      fetcher: asTestFetch(fetchMock),
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

        // SAFETY: The provider serializes this request body and the test checks its known fixture shape.
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
      fetcher: asTestFetch(fetchMock),
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

  test("retries one streamed 429 before output with the same request", async () => {
    const bodies: string[] = [];
    const cancel = mock(() => {});

    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);

        bodies.push(await request.text());

        if (bodies.length === 1) {
          return new Response(
            new ReadableStream({
              cancel,
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    streamChunk({ role: "assistant" }) +
                      streamError({
                        code: 429,
                        message: "temporarily rate-limited upstream",
                      })
                  )
                );
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } }
          );
        }

        expect(cancel).toHaveBeenCalledTimes(1);

        return new Response(
          streamChunk({ content: "recovered" }) + "data:[DONE]\r\n\r\n",
          { headers: { "Content-Type": "text/event-stream" } }
        );
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: asTestFetch(fetchMock),
      model: "openai/gpt-6-luna",
      openRouterRouting: {
        dataCollection: "deny",
        requireParameters: true,
        zdr: true,
      },
    });

    const chunks: string[] = [];

    const result = await provider.streamChat(
      {
        messages: [{ content: "hi", role: "user" }],
        system: "test",
      },
      { onChunk: (chunk) => chunks.push(chunk) }
    );

    expect(result.content).toBe("recovered");
    expect(chunks).toEqual(["recovered"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      model: "openai/gpt-6-luna",
      provider: {
        data_collection: "deny",
        require_parameters: true,
        zdr: true,
      },
    });
    expect(bodies[1]).toBe(bodies[0]);
  });

  test("stops after the retried streamed 429 and hides metadata", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          streamError({
            code: 429,
            message: "temporarily rate-limited upstream",
            metadata: {
              apiKey: "must-not-leak",
              error_type: "rate_limit_exceeded",
              provider_code: "must-not-leak",
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        )
    );

    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: asTestFetch(fetchMock),
    });

    const error = await provider
      .streamChat(
        { messages: [{ content: "hi", role: "user" }], system: "test" },
        { onChunk() {} }
      )
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("429");
    expect(String(error)).toContain("temporarily rate-limited upstream");
    expect(String(error)).not.toContain("must-not-leak");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("rejects a streamed error after output without retrying", async () => {
    for (const [, delta] of [
      ["text", { content: "partial" }],
      ["thinking", { reasoning: "partial plan" }],
      [
        "tool call",
        {
          tool_calls: [
            {
              function: {
                arguments: '{"path":"a.txt"}',
                name: "write_file",
              },
              id: "call_1",
              index: 0,
              type: "function",
            },
          ],
        },
      ],
    ] satisfies [string, ProviderJsonRecord][]) {
      const fetchMock = mock(
        async () =>
          new Response(
            streamChunk(delta) +
              streamError({ code: 429, message: "rate limited after output" }),
            { headers: { "Content-Type": "text/event-stream" } }
          )
      );

      const provider = createOpenRouterProvider({
        apiKey: "test-key",
        fetcher: asTestFetch(fetchMock),
      });

      await expect(
        provider.streamChat(
          { messages: [{ content: "hi", role: "user" }], system: "test" },
          { onChunk() {} }
        )
      ).rejects.toThrow("429");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test("does not retry a non-transient streamed error", async () => {
    const fetchMock = mock(
      async () =>
        new Response(streamError({ code: 400, message: "invalid request" }), {
          headers: { "Content-Type": "text/event-stream" },
        })
    );

    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: asTestFetch(fetchMock),
    });

    await expect(
      provider.streamChat(
        { messages: [{ content: "hi", role: "user" }], system: "test" },
        { onChunk() {} }
      )
    ).rejects.toThrow("400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("cancels during the streamed 429 retry delay", async () => {
    const controller = new AbortController();
    const cancelled = Promise.withResolvers<void>();

    const fetchMock = mock(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled.resolve();
            },
            start(stream) {
              stream.enqueue(
                new TextEncoder().encode(
                  streamError({ code: 429, message: "rate limited" })
                )
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        )
    );

    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: asTestFetch(fetchMock),
    });

    const promise = provider.streamChat(
      {
        messages: [{ content: "hi", role: "user" }],
        signal: controller.signal,
        system: "test",
      },
      { onChunk() {} }
    );

    await cancelled.promise;
    // The reader has consumed the error; the next task runs during the delay.
    setTimeout(() => controller.abort(), 0);

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("does not add SDK retries for HTTP errors", async () => {
    for (const afterStreamError of [false, true]) {
      let requests = 0;

      const fetchMock = mock(async () => {
        requests += 1;

        if (afterStreamError && requests === 1) {
          return new Response(
            streamError({ code: 429, message: "rate limited" }),
            { headers: { "Content-Type": "text/event-stream" } }
          );
        }

        return new Response("upstream unavailable", { status: 503 });
      });

      const provider = createOpenRouterProvider({
        apiKey: "test-key",
        fetcher: asTestFetch(fetchMock),
      });

      await expect(
        provider.streamChat(
          { messages: [{ content: "hi", role: "user" }], system: "test" },
          { onChunk() {} }
        )
      ).rejects.toThrow("503");
      expect(fetchMock).toHaveBeenCalledTimes(afterStreamError ? 2 : 1);
    }
  });

  test("rejects an error alongside a tool delta before notifying handlers", async () => {
    const chunk = streamChunk(
      {
        tool_calls: [
          {
            function: { arguments: '{"path":"a.txt"}', name: "write_file" },
            id: "call_1",
            index: 0,
            type: "function",
          },
        ],
      },
      { code: 429, message: "rate limited" }
    );

    const fetchMock = mock(
      async () =>
        new Response(chunk, {
          headers: { "Content-Type": "text/event-stream" },
        })
    );

    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: asTestFetch(fetchMock),
    });

    const onToolInputDelta = mock(() => {});

    await expect(
      provider.streamChat(
        { messages: [{ content: "hi", role: "user" }], system: "test" },
        { onChunk() {}, onToolInputDelta }
      )
    ).rejects.toThrow("429");
    expect(onToolInputDelta).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("bounds streamed error messages and removes control characters", async () => {
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: async () =>
        new Response(
          streamError({ code: 400, message: `bad\n\u001b${"x".repeat(400)}` }),
          { headers: { "Content-Type": "text/event-stream" } }
        ),
    });

    const error = await provider
      .streamChat(
        { messages: [{ content: "hi", role: "user" }], system: "test" },
        { onChunk() {} }
      )
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("400");
    expect(String(error)).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(String(error).length).toBeLessThan(350);
  });
});
