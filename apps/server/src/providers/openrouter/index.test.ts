import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { type ProviderJsonRecord, parseJsonRecord } from "../shared";
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
  test("reads text parts from structured chat and text responses", async () => {
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: async () =>
        new Response(
          chatCompletionResponse([
            { text: "Hello", type: "text" },
            { text: " world", type: "text" },
          ]),
          { headers: { "Content-Type": "application/json" } }
        ),
    });

    expect(
      (await provider.generateChat({ messages: [], system: "test" })).content
    ).toBe("Hello world");
    expect(
      (
        await provider.generateText({
          format: "text",
          prompt: "hi",
          system: "test",
        })
      ).content
    ).toBe("Hello world");
  });

  test("rejects a response mode that does not match the request", async () => {
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetcher: async (input, init) => {
        const request =
          input instanceof Request ? input : new Request(input, init);

        const body = parseJsonRecord(await request.text());

        return body.stream
          ? new Response(chatCompletionResponse("unexpected"), {
              headers: { "Content-Type": "application/json" },
            })
          : new Response(
              streamFromChunks([streamChunk({ content: "unexpected" })]),
              {
                headers: { "Content-Type": "text/event-stream" },
              }
            );
      },
    });

    await expect(
      provider.generateChat({ messages: [], system: "test" })
    ).rejects.toThrow();
    await expect(
      provider.generateText({ prompt: "hi", system: "test" })
    ).rejects.toThrow();
    const onChunk = mock(() => {});
    await expect(
      provider.streamChat({ messages: [], system: "test" }, { onChunk })
    ).rejects.toThrow();
    expect(onChunk).not.toHaveBeenCalled();
  });

  test("serializes routing on every dedicated request path", async () => {
    for (const [openRouterRouting, expected] of [
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
    ] satisfies [OpenRouterRoutingSettings | undefined, unknown][]) {
      const bodies: ProviderJsonRecord[] = [];

      const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);

        const body = parseJsonRecord(await request.text());
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
        if (expected === undefined) {
          expect(body.provider).toBeUndefined();
        } else {
          expect(body).toEqual(expect.objectContaining({ provider: expected }));
        }

        expect(body.model).toBe("openai/gpt-6-luna");
        expect(body).not.toHaveProperty("extra_body");

        if (expected === undefined) {
          expect(body).not.toHaveProperty("provider");
        }
      }

      expect(bodies[3]?.response_format).toEqual({ type: "json_object" });
    }
  });

  test("create, persist, update and clear routing through the instance factory", async () => {
    const previousDir = process.env.NAKAMA_CONFIG_DIR;
    const directory = await mkdtemp(join(tmpdir(), "nakama-routing-"));
    const bodies: ProviderJsonRecord[] = [];

    const server = setupServer(
      http.post(
        "https://openrouter.ai/api/v1/chat/completions",
        async ({ request }) => {
          const body = parseJsonRecord(await request.text());
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
          if (wire === undefined) {
            expect(body).not.toHaveProperty("provider");
          } else {
            expect(body).toEqual(expect.objectContaining({ provider: wire }));
          }
        }

        await createProviderForInstance(
          otherLoaded,
          "openai/gpt-6-luna"
        )!.generateChat(input);
        const requests = bodies.splice(0);
        expect(requests).toHaveLength(1);
        expect(requests[0]?.provider).toBeUndefined();
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
      fetcher: asTestFetch(fetchMock),
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

        // SAFETY: The provider serializes this request body and the test checks its known fixture shape.
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
      fetcher: asTestFetch(fetchMock),
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

        // SAFETY: The provider serializes this request body and the test checks its known fixture shape.
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
      fetcher: asTestFetch(fetchMock),
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
      fetcher: asTestFetch(fetchMock),
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
});
