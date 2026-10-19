import { describe, expect, mock, test } from "bun:test";
import { createAgentChatSession } from "@nakama/agent";
import type { ProviderJsonRecord } from "../shared";
import { asTestFetch } from "../test-helpers";
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
  test("safely rejects a malformed streamed error", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          streamError({ code: "private-code", message: { token: "secret" } }),
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
    expect(String(error)).not.toContain("private-code");
    expect(String(error)).not.toContain("secret");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("rejects cancellation between buffered chunks without a tool preview", async () => {
    const abort = new AbortController();
    let requests = 0;

    const server = Bun.serve({
      fetch() {
        requests += 1;

        return new Response(
          streamChunk({ content: "partial" }) +
            streamChunk({
              tool_calls: [
                {
                  function: {
                    arguments: '{"path":"a.txt"}',
                    name: "write_file",
                  },
                  id: "call_cancelled",
                  index: 0,
                  type: "function",
                },
              ],
            }) +
            "data:[DONE]\r\n\r\n",
          { headers: { "Content-Type": "text/event-stream" } }
        );
      },
      hostname: "127.0.0.1",
      port: 0,
    });

    try {
      const provider = createOpenRouterProvider({
        apiKey: "offline-test",
        fetcher: (input, init) => {
          const request =
            input instanceof Request ? input : new Request(input, init);

          return fetch(new Request(server.url, request));
        },
      });

      const onToolInputDelta = mock(() => {});
      await expect(
        provider.streamChat(
          {
            messages: [{ content: "hi", role: "user" }],
            signal: abort.signal,
            system: "test",
          },
          {
            onChunk() {
              abort.abort();
            },
            onToolInputDelta,
          }
        )
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(onToolInputDelta).not.toHaveBeenCalled();
      expect(requests).toBe(1);
    } finally {
      await server.stop(true);
    }
  });

  test("stops callbacks within one chunk when aborted", async () => {
    for (const [abortAt, expectedCallbacks] of [
      ["thinking", ["thinking"]],
      ["text", ["thinking", "text"]],
      ["tool", ["thinking", "text", "call_1"]],
      [undefined, ["thinking", "text", "call_1", "call_2"]],
    ] satisfies [string | undefined, string[]][]) {
      const abort = new AbortController();
      const callbacks: string[] = [];

      const provider = createOpenRouterProvider({
        apiKey: "offline-test",
        fetcher: async () =>
          new Response(
            streamChunk({
              content: "answer",
              reasoning: "plan",
              tool_calls: [0, 1].map((index) => ({
                function: {
                  arguments: `{"path":"${index}.txt"}`,
                  name: "write_file",
                },
                id: `call_${index + 1}`,
                index,
                type: "function",
              })),
            }) + "data:[DONE]\r\n\r\n",
            { headers: { "Content-Type": "text/event-stream" } }
          ),
      });

      const promise = provider.streamChat(
        {
          messages: [{ content: "hi", role: "user" }],
          signal: abort.signal,
          system: "test",
        },
        {
          onChunk() {
            callbacks.push("text");

            if (abortAt === "text") {
              abort.abort();
            }
          },
          onThinking() {
            callbacks.push("thinking");

            if (abortAt === "thinking") {
              abort.abort();
            }
          },
          onToolInputDelta(event) {
            callbacks.push(event.toolCallId);

            if (abortAt === "tool") {
              abort.abort();
            }
          },
        }
      );

      if (abortAt) {
        await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      } else {
        expect(await promise).toMatchObject({
          assistantMessage: { thinking: "plan" },
          content: "answer",
          toolCalls: [
            { arguments: { path: "0.txt" }, id: "call_1", name: "write_file" },
            { arguments: { path: "1.txt" }, id: "call_2", name: "write_file" },
          ],
        });
      }

      expect(callbacks).toEqual(expectedCallbacks);
    }
  });

  test("rejects an already aborted stream before invoking fetch", async () => {
    const abort = new AbortController();
    abort.abort();

    const fetcher = mock(
      async () =>
        new Response(streamChunk({ content: "late" }) + "data:[DONE]\r\n\r\n", {
          headers: { "Content-Type": "text/event-stream" },
        })
    );

    const provider = createOpenRouterProvider({
      apiKey: "offline-test",
      fetcher,
    });

    await expect(
      provider.streamChat(
        {
          messages: [{ content: "hi", role: "user" }],
          signal: abort.signal,
          system: "test",
        },
        { onChunk() {} }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("does not emit a buffered chunk when cancellation arrives with the response", async () => {
    const abort = new AbortController();
    const onChunk = mock(() => {});

    const provider = createOpenRouterProvider({
      apiKey: "offline-test",
      fetcher: async () => {
        abort.abort();

        return new Response(
          streamChunk({ content: "late" }) + "data:[DONE]\r\n\r\n",
          {
            headers: { "Content-Type": "text/event-stream" },
          }
        );
      },
    });

    await expect(
      provider.streamChat(
        {
          messages: [{ content: "hi", role: "user" }],
          signal: abort.signal,
          system: "test",
        },
        { onChunk }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onChunk).not.toHaveBeenCalled();
  });

  test("rejects cancellation while finishing the stream after its last tool delta", async () => {
    const abort = new AbortController();
    const delivered = Promise.withResolvers<void>();
    const onToolInputDelta = mock(() => delivered.resolve());

    const cancel = mock(async () => {
      await delivered.promise;
      abort.abort();
    });

    const provider = createOpenRouterProvider({
      apiKey: "offline-test",
      fetcher: async () =>
        new Response(
          new ReadableStream({
            cancel,
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  streamChunk({
                    tool_calls: [
                      {
                        function: {
                          arguments: '{"path":"a.txt"}',
                          name: "write_file",
                        },
                        id: "call_late",
                        index: 0,
                        type: "function",
                      },
                    ],
                  }) + "data:[DONE]\r\n\r\n"
                )
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        ),
    });

    await expect(
      provider.streamChat(
        {
          messages: [{ content: "hi", role: "user" }],
          signal: abort.signal,
          system: "test",
        },
        { onChunk() {}, onToolInputDelta }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onToolInputDelta).toHaveBeenCalledTimes(1);
  });

  test("cancelled buffered output never executes a tool through the agent", async () => {
    const abort = new AbortController();
    const run = mock(async () => ({ saved: true }));

    const provider = createOpenRouterProvider({
      apiKey: "offline-test",
      fetcher: async () =>
        new Response(
          streamChunk({ content: "partial" }) +
            streamChunk({
              tool_calls: [
                {
                  function: {
                    arguments: '{"path":"a.txt"}',
                    name: "write_file",
                  },
                  id: "call_cancelled",
                  index: 0,
                  type: "function",
                },
              ],
            }) +
            "data:[DONE]\r\n\r\n",
          { headers: { "Content-Type": "text/event-stream" } }
        ),
    });

    const tools = [
      {
        description: "Write",
        name: "write_file",
        parameters: { type: "object" },
        run,
      },
    ];

    const session = createAgentChatSession({ provider, tools }, { tools });
    await expect(
      session.sendStream(
        "hi",
        {
          onChunk() {
            abort.abort();
          },
        },
        { signal: abort.signal }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
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
      fetcher: asTestFetch(fetchMock),
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
