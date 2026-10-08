import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type ProviderJsonRecord,
  parseJsonRecord,
  readRecord,
} from "../shared";
import { asTestFetch, streamFromChunks } from "../test-helpers";
import { createOpenAICompatibleProvider } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const netraProvider = (model = "deepseek/deepseek-v4-flash-0731") =>
  createOpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl: "https://api.netraruntime.com/v1",
    displayName: "Netra Runtime",
    model,
    providerName: "netra",
    supportsThinking: true,
  });

const netraStream = (chunks: string[]) =>
  new Response(streamFromChunks(chunks), {
    headers: { "Content-Type": "text/event-stream" },
    status: 200,
  });

describe("OpenAI-compatible provider", () => {
  test("Netra text generation asks for JSON without an unsupported response format", async () => {
    globalThis.fetch = asTestFetch(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = parseJsonRecord(String(init?.body));
        expect(body.response_format).toBeUndefined();

        return Response.json({
          choices: [{ message: { content: '{"ok":true}' } }],
        });
      })
    );

    const result = await netraProvider().generateText({
      format: "json",
      prompt: "Return JSON",
      system: "Return JSON",
    });

    expect(result.content).toBe('{"ok":true}');
  });

  test("Netra sends one reasoning control and preserves tool continuation", async () => {
    const calls: ProviderJsonRecord[] = [];
    globalThis.fetch = asTestFetch(
      mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://api.netraruntime.com/v1/chat/completions"
        );
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer test-key"
        );
        const body = parseJsonRecord(String(init?.body));
        calls.push(body);

        if (calls.length === 1) {
          return Response.json({
            choices: [
              {
                message: {
                  content: null,
                  reasoning_content: "I need data",
                  reasoning_details: [
                    {
                      data: "opaque",
                      signature: "real",
                      type: "reasoning.encrypted",
                    },
                  ],
                  tool_calls: [
                    {
                      function: { arguments: "{}", name: "lookup" },
                      id: "call_1",
                      type: "function",
                    },
                  ],
                },
              },
            ],
          });
        }

        return Response.json({ choices: [{ message: { content: "Done" } }] });
      })
    );

    const provider = netraProvider();

    const tool = {
      description: "Look up data",
      name: "lookup",
      parameters: { properties: {}, type: "object" },
    };

    const first = await provider.generateChat({
      messages: [{ content: "Find data", role: "user" }],
      providerOptions: { thinking: { effort: "medium", enabled: true } },
      system: "Help",
      tools: [tool],
    });

    expect(calls[0]?.reasoning).toEqual({ effort: "high" });
    expect(calls[0]?.reasoning_effort).toBeUndefined();
    expect(first.assistantMessage.providerContent).toEqual([
      { data: "opaque", signature: "real", type: "reasoning.encrypted" },
    ]);
    expect(first.toolCalls[0]?.id).toBe("call_1");

    await provider.generateChat({
      messages: [
        { content: "Find data", role: "user" },
        first.assistantMessage,
        { content: "42", name: "lookup", role: "tool", toolCallId: "call_1" },
      ],
      providerOptions: { thinking: { enabled: false } },
      system: "Help",
      tools: [tool],
    });
    expect(calls[1]?.reasoning).toEqual({ enabled: false });
    const messages = Array.isArray(calls[1]?.messages) ? calls[1].messages : [];
    expect(readRecord(messages[2]).reasoning_details).toEqual([
      { data: "opaque", signature: "real", type: "reasoning.encrypted" },
    ]);
    expect(readRecord(messages[3]).tool_call_id).toBe("call_1");
  });

  test("Netra rejects a terminal stream error after partial text", async () => {
    globalThis.fetch = asTestFetch(
      mock(async () =>
        netraStream([
          'data: {"choices":[{"delta":{"content":"Part"}}]}\n\n',
          'event: error\ndata: {"error":{"message":"balance exhausted"}}\n\n',
          "data: [DONE]\n\n",
        ])
      )
    );
    const provider = netraProvider();
    const chunks: string[] = [];
    await expect(
      provider.streamChat(
        { messages: [{ content: "Hi", role: "user" }], system: "Help" },
        { onChunk: (chunk) => chunks.push(chunk) }
      )
    ).rejects.toThrow("stream failed");
    expect(chunks).toEqual(["Part"]);
  });

  test("Netra rejects a stream that closes before DONE", async () => {
    globalThis.fetch = asTestFetch(
      mock(async () =>
        netraStream(['data: {"choices":[{"delta":{"content":"Part"}}]}\n\n'])
      )
    );
    const provider = netraProvider();
    await expect(
      provider.streamChat(
        { messages: [{ content: "Hi", role: "user" }], system: "Help" },
        { onChunk: () => {} }
      )
    ).rejects.toThrow("before [DONE]");
  });

  test("sends reasoning config only when the model supports thinking", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://api.example.com/v1/chat/completions"
        );

        const body = parseJsonRecord(String(init?.body ?? "{}"));

        expect(body.reasoning).toEqual({ effort: "high" });
        expect(body.reasoning_effort).toBe("high");

        return Response.json({
          choices: [{ message: { content: "Answer", reasoning: "Plan" } }],
        });
      }
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      displayName: "NetraRuntime",
      model: "qwen3.6-35b",
      supportsThinking: true,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Think then answer", role: "user" }],
      providerOptions: { thinking: { effort: "high", enabled: true } },
      system: "You are helpful.",
    });

    expect(result.assistantMessage.thinking).toBe("Plan");
    expect(result.usage).toBeUndefined();

    // SAFETY: fetchWithoutIdleTimeout adds idleTimeout before calling fetch.
    const completionInit = fetchMock.mock.calls[0]?.[1] as
      | (RequestInit & { idleTimeout?: number })
      | undefined;

    expect(completionInit?.idleTimeout).toBe(0);
  });

  test("omits reasoning config when the model does not support thinking", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = parseJsonRecord(String(init?.body ?? "{}"));

        expect(body.reasoning).toBeUndefined();
        expect(body.reasoning_effort).toBeUndefined();

        return Response.json({
          choices: [{ message: { content: "Answer" } }],
        });
      }
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      displayName: "NetraRuntime",
      model: "qwen3.6-7b",
      supportsThinking: false,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Think then answer", role: "user" }],
      providerOptions: { thinking: { effort: "high", enabled: true } },
      system: "You are helpful.",
    });

    expect(result.content).toBe("Answer");
  });

  test("sets reasoning_effort to none for gpt-5.6 tools on chat completions", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = parseJsonRecord(String(init?.body ?? "{}"));

        expect(body.tools).toHaveLength(1);
        expect(body.reasoning).toBeUndefined();
        expect(body.reasoning_effort).toBe("none");

        return Response.json({
          choices: [{ message: { content: "Answer" } }],
        });
      }
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      displayName: "OpenAI",
      model: "gpt-5.6-luna",
      supportsThinking: true,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Search", role: "user" }],
      providerOptions: { thinking: { effort: "high", enabled: true } },
      system: "You are helpful.",
      tools: [
        {
          description: "Search files",
          name: "search_files",
          parameters: { properties: {}, type: "object" },
        },
      ],
    });

    expect(result.content).toBe("Answer");
  });

  test("forces reasoning_effort none for gpt-5.6 tools even when thinking is off", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = parseJsonRecord(String(init?.body ?? "{}"));

        expect(body.tools).toHaveLength(1);
        expect(body.reasoning).toBeUndefined();
        expect(body.reasoning_effort).toBe("none");

        return Response.json({
          choices: [{ message: { content: "Answer" } }],
        });
      }
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      displayName: "OpenAI",
      model: "gpt-5.6-luna",
      supportsThinking: true,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Search", role: "user" }],
      system: "You are helpful.",
      tools: [
        {
          description: "Search files",
          name: "search_files",
          parameters: { properties: {}, type: "object" },
        },
      ],
    });

    expect(result.content).toBe("Answer");
  });

  test("does not send Astra tools or reasoning_effort none to a chat-only endpoint", async () => {
    const fetchMock = mock(async () => Response.json({}));
    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.example.com/v1",
      displayName: "Proxy",
      model: "gpt-6-astra",
      supportsThinking: true,
    });

    await expect(
      provider.generateChat({
        messages: [{ content: "Search", role: "user" }],
        system: "Be helpful.",
        tools: [
          {
            description: "Search",
            name: "search",
            parameters: { properties: {}, type: "object" },
          },
        ],
      })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("keeps reasoning_effort for non-OpenAI models with tools", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = parseJsonRecord(String(init?.body ?? "{}"));

        expect(body.tools).toHaveLength(1);
        expect(body.reasoning_effort).toBe("high");

        return Response.json({
          choices: [{ message: { content: "Answer" } }],
        });
      }
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      displayName: "NetraRuntime",
      model: "qwen3.6-35b",
      supportsThinking: true,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Search", role: "user" }],
      providerOptions: { thinking: { effort: "high", enabled: true } },
      system: "You are helpful.",
      tools: [
        {
          description: "Search files",
          name: "search_files",
          parameters: { properties: {}, type: "object" },
        },
      ],
    });

    expect(result.content).toBe("Answer");
  });

  test("preserves leading spaces in streamed reasoning_content deltas", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          streamFromChunks([
            'data: {"choices":[{"delta":{"reasoning_content":"The"}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":" user"}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":" wants"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
            "data: [DONE]\n\n",
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        )
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://opencode.ai/zen/v1",
      displayName: "OpenCode Zen",
      model: "big-pickle",
      supportsThinking: true,
    });

    const thinking: string[] = [];

    const result = await provider.streamChat(
      {
        messages: [{ content: "Think then answer", role: "user" }],
        providerOptions: { thinking: { effort: "medium", enabled: true } },
        system: "You are helpful.",
      },
      {
        onChunk: () => {},
        onThinking: (delta) => thinking.push(delta),
      }
    );

    expect(thinking).toEqual(["The", " user", " wants"]);
    expect(result.assistantMessage.thinking).toBe("The user wants");
  });

  test("streams reasoning deltas when thinking is enabled for a supported model", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          streamFromChunks([
            'data: {"choices":[{"delta":{"reasoning":"Plan"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
            "data: [DONE]\n\n",
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        )
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      displayName: "NetraRuntime",
      model: "qwen3.6-35b",
      supportsThinking: true,
    });

    const thinking: string[] = [];
    const chunks: string[] = [];

    const result = await provider.streamChat(
      {
        messages: [{ content: "Think then answer", role: "user" }],
        providerOptions: { thinking: { effort: "medium", enabled: true } },
        system: "You are helpful.",
      },
      {
        onChunk: (delta) => chunks.push(delta),
        onThinking: (delta) => thinking.push(delta),
      }
    );

    expect(chunks).toEqual(["Hi"]);
    expect(thinking).toEqual(["Plan"]);
    expect(result.assistantMessage.thinking).toBe("Plan");
  });

  test("captures API-reported usage for non-streaming chat", async () => {
    const fetchMock = mock(async () =>
      Response.json({
        choices: [{ message: { content: "Answer" } }],
        usage: {
          completion_tokens: 30,
          prompt_tokens: 120,
          total_tokens: 150,
        },
      })
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      displayName: "NetraRuntime",
      model: "qwen3.6-35b",
      supportsThinking: false,
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      system: "You are helpful.",
    });

    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    });
  });

  test("captures API-reported usage for streaming chat", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = parseJsonRecord(String(init?.body ?? "{}"));

        expect(body.stream_options).toEqual({ include_usage: true });

        return new Response(
          streamFromChunks([
            'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
            'data: {"usage":{"prompt_tokens":88,"completion_tokens":12,"total_tokens":100},"choices":[]}\n\n',
            "data: [DONE]\n\n",
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        );
      }
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "",
      baseUrl: "https://api.example.com/v1",
      displayName: "NetraRuntime",
      model: "qwen3.6-35b",
      supportsThinking: false,
    });

    const result = await provider.streamChat(
      {
        messages: [{ content: "Hi", role: "user" }],
        system: "You are helpful.",
      },
      { onChunk: () => {} }
    );

    expect(result.usage).toEqual({
      inputTokens: 88,
      outputTokens: 12,
      totalTokens: 100,
    });
  });

  test("surfaces JSON provider errors on stream requests", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Rate limit exceeded. Please try again later.",
              type: "FreeUsageLimitError",
            },
            type: "error",
          }),
          { headers: { "Content-Type": "application/json" }, status: 429 }
        )
    );

    globalThis.fetch = asTestFetch(fetchMock);

    const provider = createOpenAICompatibleProvider({
      apiKey: "public",
      baseUrl: "https://opencode.ai/zen/v1",
      displayName: "OpenCode Zen",
      model: "big-pickle",
      supportsThinking: false,
    });

    await expect(
      provider.streamChat(
        {
          messages: [{ content: "Hi", role: "user" }],
          system: "You are helpful.",
        },
        { onChunk: () => {} }
      )
    ).rejects.toThrow(
      "OpenCode Zen request failed (429 FreeUsageLimitError): Rate limit exceeded. Please try again later."
    );
  });
});
