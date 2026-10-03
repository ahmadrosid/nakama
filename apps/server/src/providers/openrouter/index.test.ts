import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentChatSession } from "@nakama/agent";
import {
  loadUserConfig,
  type OpenRouterRoutingSettings,
  saveUserConfig,
} from "@nakama/core";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  applyProviderInstanceUpdate,
  buildProviderInstanceFromCreateRequest,
  toProviderInstanceSummary,
} from "../../services/provider-instance-helpers";
import { createProviderForInstance } from "../create";
import { streamFromChunks } from "../test-helpers";
import { createOpenRouterProvider } from "./index";

function chatCompletionResponse(
  content: string,
  options: { toolCalls?: unknown[]; reasoning?: string } = {}
) {
  return JSON.stringify({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: {
          content,
          role: "assistant",
          ...(options.reasoning ? { reasoning: options.reasoning } : {}),
          ...(options.toolCalls ? { tool_calls: options.toolCalls } : {}),
        },
      },
    ],
    created: 1_700_000_000,
    id: "gen-test",
    model: "anthropic/claude-sonnet-4-6",
    object: "chat.completion",
    system_fingerprint: null,
  });
}

function streamChunk(delta: Record<string, unknown>, error?: unknown): string {
  return `data:${JSON.stringify({
    choices: [{ delta, finish_reason: null, index: 0 }],
    created: 1_700_000_000,
    error,
    id: "chunk-1",
    model: "anthropic/claude-sonnet-4-6",
    object: "chat.completion.chunk",
  })}\r\n\r\n`;
}

function streamError(error: unknown): string {
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
  test.each([
    [undefined, undefined],
    [{}, undefined],
    [
      { dataCollection: "deny", requireParameters: true, zdr: true },
      { data_collection: "deny", require_parameters: true, zdr: true },
    ],
    [
      { dataCollection: "allow", requireParameters: false, zdr: false },
      { data_collection: "allow", require_parameters: false, zdr: false },
    ],
    [{ requireParameters: true }, { require_parameters: true }],
  ] satisfies [OpenRouterRoutingSettings | undefined, unknown][])(
    "serializes routing %j on every dedicated request path",
    async (openRouterRouting, expected) => {
      const bodies: Record<string, unknown>[] = [];
      const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return body.stream
          ? new Response(
              streamFromChunks([
                streamChunk({ content: "ok" }),
                "data:[DONE]\r\n\r\n",
              ]),
              { headers: { "Content-Type": "text/event-stream" } }
            )
          : new Response(chatCompletionResponse("ok"), {
              headers: { "Content-Type": "application/json" },
            });
      };
      const provider = createOpenRouterProvider({
        apiKey: "test-key",
        fetcher,
        model: "openai/gpt-6-luna",
        openRouterRouting,
      });
      const input = {
        messages: [{ content: "hi", role: "user" as const }],
        system: "test",
      };
      expect((await provider.generateChat(input)).content).toBe("ok");
      expect((await provider.streamChat(input, { onChunk() {} })).content).toBe(
        "ok"
      );
      for (const format of ["text", "json"] as const) {
        expect(
          (
            await provider.generateText({
              format,
              prompt: "hi",
              system: "test",
            })
          ).content
        ).toBe("ok");
      }
      expect(bodies.map((body) => body.stream)).toEqual([
        false,
        true,
        false,
        false,
      ]);
      for (const body of bodies) {
        expect(body.provider).toEqual(expected);
        expect(body.model).toBe("openai/gpt-6-luna");
        expect(body).not.toHaveProperty("extra_body");
        if (expected === undefined) {
          expect(body).not.toHaveProperty("provider");
        }
      }
      expect(bodies[3]?.response_format).toEqual({ type: "json_object" });
    }
  );

  test("create, persist, update and clear routing through the instance factory", async () => {
    const previousDir = process.env.NAKAMA_CONFIG_DIR;
    const directory = await mkdtemp(join(tmpdir(), "nakama-routing-"));
    const bodies: Record<string, unknown>[] = [];
    const server = setupServer(
      http.post(
        "https://openrouter.ai/api/v1/chat/completions",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          bodies.push(body);
          return body.stream
            ? new HttpResponse(
                streamChunk({ content: "ok" }) + "data:[DONE]\r\n\r\n",
                { headers: { "Content-Type": "text/event-stream" } }
              )
            : new HttpResponse(chatCompletionResponse("ok"), {
                headers: { "Content-Type": "application/json" },
              });
        }
      )
    );
    server.listen({ onUnhandledRequest: "error" });
    process.env.NAKAMA_CONFIG_DIR = directory;
    try {
      const strict = {
        dataCollection: "deny",
        requireParameters: true,
        zdr: true,
      } as const;
      let instance = buildProviderInstanceFromCreateRequest(
        {
          apiKey: `sk-or-${"x".repeat(24)}`,
          openRouterRouting: strict,
          type: "openrouter",
        },
        []
      );
      const other = buildProviderInstanceFromCreateRequest(
        { apiKey: `sk-or-${"y".repeat(24)}`, type: "openrouter" },
        [instance]
      );
      const stages = [
        [
          undefined,
          strict,
          { data_collection: "deny", require_parameters: true, zdr: true },
        ],
        [
          { label: "Renamed" },
          strict,
          { data_collection: "deny", require_parameters: true, zdr: true },
        ],
        [
          {
            openRouterRouting: {
              dataCollection: "allow",
              requireParameters: false,
              zdr: false,
            },
          },
          { dataCollection: "allow", requireParameters: false, zdr: false },
          { data_collection: "allow", require_parameters: false, zdr: false },
        ],
        [{ openRouterRouting: { zdr: true } }, { zdr: true }, { zdr: true }],
        [{ openRouterRouting: {} }, undefined, undefined],
      ] as const;
      for (const [update, saved, wire] of stages) {
        if (update) {
          instance = applyProviderInstanceUpdate(instance, update);
        }
        await saveUserConfig({
          defaultProviderId: instance.id,
          providers: [instance, other],
        });
        const loaded = await loadUserConfig();
        instance = loaded!.providers.find((entry) => entry.id === instance.id)!;
        expect(instance.openRouterRouting).toEqual(saved);
        expect(
          toProviderInstanceSummary(instance, 0).openRouterRouting
        ).toEqual(saved);
        const otherLoaded = loaded!.providers.find(
          (entry) => entry.id === other.id
        )!;
        expect(otherLoaded.openRouterRouting).toBeUndefined();
        const client = createProviderForInstance(
          instance,
          "openai/gpt-6-luna"
        )!;
        const input = {
          messages: [{ content: "hi", role: "user" as const }],
          system: "test",
        };
        await client.generateChat(input);
        await client.streamChat(input, { onChunk() {} });
        await client.generateText({ prompt: "hi", system: "test" });
        for (const body of bodies.splice(0)) {
          expect(body.provider).toEqual(wire);
        }
        await createProviderForInstance(
          otherLoaded,
          "openai/gpt-6-luna"
        )!.generateChat(input);
        expect(bodies.splice(0).map((body) => body.provider)).toEqual([
          undefined,
        ]);
      }
    } finally {
      server.close();
      if (previousDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousDir;
      }
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("calls OpenRouter chat completions via SDK", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        expect(request.url).toContain("/chat/completions");
        const headers = request.headers;
        expect(headers.get("Authorization")).toBe("Bearer sk-or-v1-test");
        expect(headers.get("HTTP-Referer")).toBe(
          "https://github.com/ahmadrosid/nakama"
        );
        expect(headers.get("X-OpenRouter-Title")).toBe("Nakama");

        return new Response(chatCompletionResponse("Hello from OpenRouter"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
      model: "anthropic/claude-sonnet-4-6",
    });

    const result = await provider.generateText({
      format: "text",
      prompt: "Say hi",
      system: "You are helpful.",
    });

    expect(result.content).toBe("Hello from OpenRouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("serializes user image parts with the OpenRouter SDK shape", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as {
          messages: Array<{ content: unknown; role: string }>;
        };

        expect(body.messages[1]).toEqual({
          content: [
            { text: "What is this?", type: "text" },
            {
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
              },
              type: "image_url",
            },
          ],
          role: "user",
        });

        return new Response(chatCompletionResponse("A tiny image"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: fetchMock as typeof fetch,
    });

    await provider.generateChat({
      messages: [
        {
          content: [
            { text: "What is this?", type: "text" },
            {
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
              mediaType: "image/png",
              type: "image",
            },
          ],
          role: "user",
        },
      ],
      system: "You are helpful.",
    });
  });

  test("serializes user document parts with the OpenRouter SDK shape", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const body = (await request.json()) as {
          messages: Array<{ content: unknown; role: string }>;
        };

        expect(body.messages[1]).toEqual({
          content: [
            { text: "Summarize this report", type: "text" },
            {
              file: {
                file_data: "data:application/pdf;base64,JVBERi0=",
                filename: "report.pdf",
              },
              type: "file",
            },
          ],
          role: "user",
        });

        return new Response(chatCompletionResponse("A short report"), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: fetchMock as typeof fetch,
    });

    await provider.generateChat({
      messages: [
        {
          content: [
            { text: "Summarize this report", type: "text" },
            {
              data: "JVBERi0=",
              filename: "report.pdf",
              mediaType: "application/pdf",
              type: "document",
            },
          ],
          role: "user",
        },
      ],
      system: "You are helpful.",
    });
  });

  test("returns tool calls from generateChat", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          chatCompletionResponse("", {
            toolCalls: [
              {
                function: { arguments: '{"path":"a.txt"}', name: "write_file" },
                id: "call_1",
                type: "function",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
    );

    const provider = createOpenRouterProvider({
      apiKey: "sk-or-v1-test",
      fetcher: fetchMock as typeof fetch,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Create a file", role: "user" }],
      system: "You are helpful.",
      tools: [
        {
          description: "Write a file",
          name: "write_file",
          parameters: { properties: {}, type: "object" },
        },
      ],
    });

    expect(result.toolCalls).toEqual([
      {
        arguments: { path: "a.txt" },
        id: "call_1",
        name: "write_file",
      },
    ]);
  });

  test("sends reasoning config when thinking is enabled", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
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
      fetcher: fetchMock as typeof fetch,
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
      fetcher: fetchMock as typeof fetch,
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
      fetcher: fetchMock as typeof fetch,
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
      fetcher: fetchMock as typeof fetch,
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
      fetcher: fetchMock as typeof fetch,
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
      fetcher: fetchMock as typeof fetch,
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

  test.each([
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
  ])(
    "rejects a streamed error after a %s delta without retrying",
    async (_, delta) => {
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
        fetcher: fetchMock as typeof fetch,
      });

      await expect(
        provider.streamChat(
          { messages: [{ content: "hi", role: "user" }], system: "test" },
          { onChunk() {} }
        )
      ).rejects.toThrow("429");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  test("does not retry a non-transient streamed error", async () => {
    const fetchMock = mock(
      async () =>
        new Response(streamError({ code: 400, message: "invalid request" }), {
          headers: { "Content-Type": "text/event-stream" },
        })
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: fetchMock as typeof fetch,
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
      fetcher: fetchMock as typeof fetch,
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

  test.each([false, true])(
    "does not add SDK retries for an HTTP error (after SSE retry: %s)",
    async (afterStreamError) => {
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
        fetcher: fetchMock as typeof fetch,
      });

      await expect(
        provider.streamChat(
          { messages: [{ content: "hi", role: "user" }], system: "test" },
          { onChunk() {} }
        )
      ).rejects.toThrow("503");
      expect(fetchMock).toHaveBeenCalledTimes(afterStreamError ? 2 : 1);
    }
  );

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
      fetcher: fetchMock as typeof fetch,
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
      fetcher: fetchMock as typeof fetch,
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

  test.each([
    ["thinking", ["thinking"]],
    ["text", ["thinking", "text"]],
    ["tool", ["thinking", "text", "call_1"]],
    [undefined, ["thinking", "text", "call_1", "call_2"]],
  ] satisfies [string | undefined, string[]][])(
    "stops callbacks within one chunk when aborted from %s",
    async (abortAt, expectedCallbacks) => {
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
  );

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
      fetcher: fetchMock as typeof fetch,
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
