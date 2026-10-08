import { afterEach, describe, expect, mock, test } from "bun:test";
import { createOpenAIProvider } from "./index";

type CapturedOpenAIRequest = {
  reasoning?: { effort?: string; summary?: string };
  reasoning_effort?: unknown;
  tools?: Array<{ name?: string; type?: string }>;
};

import {
  openAIModelRejectsChatToolsWithReasoning,
  openAIModelRequiresResponsesApi,
  openAIModelSupportsThinking,
} from "./thinking";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("openAIModelSupportsThinking", () => {
  test("denies gpt-4o-mini from the catalog", () => {
    expect(openAIModelSupportsThinking("gpt-4o-mini")).toBe(false);
  });

  test("allows gpt-5 and gpt-6 models", () => {
    expect(openAIModelSupportsThinking("gpt-5.4")).toBe(true);
    expect(openAIModelSupportsThinking("gpt-5.3-codex")).toBe(true);
    expect(openAIModelSupportsThinking("gpt-6-future")).toBe(true);
  });

  test("denies gpt-4o variants by prefix", () => {
    expect(openAIModelSupportsThinking("gpt-4o-2025-08")).toBe(false);
  });

  test("respects custom model overrides", () => {
    expect(
      openAIModelSupportsThinking("gpt-4o-mini", [
        { id: "gpt-4o-mini", supportsThinking: true },
      ])
    ).toBe(true);
  });
});

describe("openAIModelRequiresResponsesApi", () => {
  test("requires responses api for codex models", () => {
    expect(openAIModelRequiresResponsesApi("gpt-5.3-codex")).toBe(true);
    expect(openAIModelRequiresResponsesApi("GPT-5.3-Codex")).toBe(true);
    expect(openAIModelRequiresResponsesApi("gpt-5.4")).toBe(false);
  });
});

describe("openAIModelRejectsChatToolsWithReasoning", () => {
  test("flags models that can set reasoning_effort to none for chat tools", () => {
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-5.4")).toBe(true);
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-5.6-luna")).toBe(true);
    expect(openAIModelRejectsChatToolsWithReasoning("GPT-5.6-Sol")).toBe(true);
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-6.1-sol")).toBe(false);
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-6-astra")).toBe(false);
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-6-future")).toBe(true);
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-5.3")).toBe(false);
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-4o-mini")).toBe(false);
  });
});

describe("OpenAI codex vision routing", () => {
  test("routes codex image requests through the responses api", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/responses");
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("gpt-5.3-codex");
        // Catalog output capacity is not a requested generation budget.
        expect(body.max_output_tokens).toBeUndefined();

        return new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  { text: "A screenshot of settings.", type: "output_text" },
                ],
                type: "message",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        );
      }
    );

    globalThis.fetch = fetchMock;

    const provider = createOpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-5.3-codex",
    });

    const result = await provider.generateChat({
      messages: [
        {
          content: [
            {
              data: "abc",
              mediaType: "image/png",
              type: "image",
            },
          ],
          role: "user",
        },
      ],
      system: "Describe the image.",
    });

    expect(result.content).toBe("A screenshot of settings.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAI tools + reasoning routing", () => {
  test.each(["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra"])(
    "%s keeps no-tool chat on Chat Completions without forcing none",
    async (model) => {
      const requests: Array<{ url: string; body: CapturedOpenAIRequest }> = [];

      globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          url: String(url),
        });

        return Response.json({ choices: [{ message: { content: "Done." } }] });
      };

      const provider = createOpenAIProvider({ apiKey: "sk-test", model });
      expect(
        (
          await provider.generateChat({
            messages: [{ content: "Hello", role: "user" }],
            system: "Be helpful.",
          })
        ).content
      ).toBe("Done.");
      expect(requests[0]?.url).toBe(
        "https://api.openai.com/v1/chat/completions"
      );
      expect(requests[0]?.body.reasoning_effort).toBeUndefined();
      expect(requests[0]?.body.tools).toBeUndefined();
    }
  );

  test("rejects Astra tools on a custom Chat Completions endpoint before HTTP", async () => {
    const fetchMock = mock(async () => Response.json({}));
    globalThis.fetch = fetchMock;

    const provider = createOpenAIProvider({
      apiKey: "sk-test",
      baseUrl: "https://custom.example/v1",
      model: "gpt-6-astra",
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

  test.each([false, true])(
    "rejects GPT-6.1 Sol tools on a custom endpoint before HTTP (stream: %s)",
    async (streaming) => {
      const fetchMock = mock(async () => Response.json({}));
      globalThis.fetch = fetchMock;

      const provider = createOpenAIProvider({
        apiKey: "sk-test",
        baseUrl: "https://custom.example/v1",
        model: "GPT-6.1-Sol-custom",
      });

      const request = {
        messages: [{ content: "Search", role: "user" as const }],
        system: "Be helpful.",
        tools: [
          {
            description: "Search",
            name: "search",
            parameters: { properties: {}, type: "object" },
          },
        ],
      };

      await expect(
        streaming
          ? provider.streamChat(request, { onChunk: () => {} })
          : provider.generateChat(request)
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  test.each(["openai", "vercel_ai_gateway"] as const)(
    "%s respects its own tool protocol with a custom GPT-6.1 ID",
    async (providerName) => {
      const model = "GPT-6.1-Sol-custom";
      globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe(model);
        expect(body.reasoning_effort).toBeUndefined();
        expect(body.reasoning).toBeUndefined();

        if (providerName === "openai") {
          expect(String(url)).toBe("https://api.openai.com/v1/responses");
          expect(body.tools[0]).toMatchObject({
            name: "search",
            type: "function",
          });

          return Response.json({
            output: [
              {
                content: [{ text: "Done", type: "output_text" }],
                type: "message",
              },
            ],
          });
        }

        expect(String(url)).toBe("https://gateway.example/v1/chat/completions");
        expect(body.tools[0]).toMatchObject({
          function: { name: "search" },
          type: "function",
        });

        return Response.json({ choices: [{ message: { content: "Done" } }] });
      };

      const provider = createOpenAIProvider({
        apiKey: "sk-test",
        baseUrl:
          providerName === "openai" ? undefined : "https://gateway.example/v1",
        customModels: [{ id: model, supportsThinking: false }],
        model,
        providerName,
      });

      const result = await provider.generateChat({
        messages: [{ content: "Search", role: "user" }],
        providerOptions: { thinking: { enabled: false } },
        system: "Be helpful.",
        tools: [
          {
            description: "Search",
            name: "search",
            parameters: { properties: {}, type: "object" },
          },
        ],
      });

      expect(result.content).toBe("Done");
    }
  );

  test.each(["text", "json"] as const)(
    "GPT-6.1 Sol generateText supports %s without unsupported reasoning",
    async (format) => {
      globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://api.openai.com/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("gpt-6.1-sol");
        expect(body.reasoning_effort).toBeUndefined();
        expect(body.tools).toBeUndefined();
        expect(body.response_format).toEqual(
          format === "json" ? { type: "json_object" } : undefined
        );

        return Response.json({
          choices: [{ message: { content: '{"title":"Migration"}' } }],
        });
      };

      const result = await createOpenAIProvider({
        apiKey: "sk-test",
        model: "gpt-6.1-sol",
      }).generateText({
        format,
        prompt: "Name this migration",
        system: "Write a title",
      });

      expect(result.content).toBe('{"title":"Migration"}');
    }
  );

  test.each(["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra"])(
    "%s routes tools through Responses with or without explicit reasoning",
    async (model) => {
      const requests: Array<{ url: string; body: CapturedOpenAIRequest }> = [];

      globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          url: String(url),
        });

        return Response.json({
          output: [
            {
              content: [{ text: "Done.", type: "output_text" }],
              type: "message",
            },
          ],
        });
      };

      const provider = createOpenAIProvider({ apiKey: "sk-test", model });

      for (const thinking of [
        undefined,
        { effort: "high" as const, enabled: true },
      ]) {
        expect(
          (
            await provider.generateChat({
              messages: [{ content: "Search", role: "user" }],
              providerOptions: thinking ? { thinking } : undefined,
              system: "Be helpful.",
              tools: [
                {
                  description: "Search files",
                  name: "search_files",
                  parameters: { properties: {}, type: "object" },
                },
              ],
            })
          ).content
        ).toBe("Done.");
      }

      expect(requests.map(({ url }) => url)).toEqual([
        "https://api.openai.com/v1/responses",
        "https://api.openai.com/v1/responses",
      ]);
      expect(requests[0]?.body.tools).toEqual([
        {
          description: "Search files",
          name: "search_files",
          parameters: { properties: {}, type: "object" },
          type: "function",
        },
      ]);
      expect(requests[0]?.body.reasoning).toBeUndefined();
      expect(requests[1]?.body.reasoning).toEqual({
        effort: "high",
        summary: "auto",
      });
    }
  );

  test("routes gpt-5.6-luna tool calls through responses even without thinking", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/responses");

        // SAFETY: The test parses a request body serialized by the provider under test.
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          tools?: Array<{ type?: string; name?: string }>;
          reasoning?: unknown;
          reasoning_effort?: unknown;
        };

        expect(body.tools?.some((tool) => tool.name === "search_files")).toBe(
          true
        );
        expect(body.reasoning).toBeUndefined();
        expect(body.reasoning_effort).toBeUndefined();

        return new Response(
          JSON.stringify({
            output: [
              {
                content: [{ text: "Done.", type: "output_text" }],
                type: "message",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        );
      }
    );

    globalThis.fetch = fetchMock;

    const provider = createOpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-5.6-luna",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Search for readme", role: "user" }],
      system: "You are helpful.",
      tools: [
        {
          description: "Search files",
          name: "search_files",
          parameters: { properties: {}, type: "object" },
        },
      ],
    });

    expect(result.content).toBe("Done.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("routes thinking + tools for gpt-5.4 through responses with reasoning", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/responses");

        // SAFETY: The test parses a request body serialized by the provider under test.
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          tools?: unknown[];
          reasoning?: { effort?: string };
        };

        expect(body.tools?.length).toBe(1);
        expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });

        return new Response(
          JSON.stringify({
            output: [
              {
                content: [{ text: "Done.", type: "output_text" }],
                type: "message",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        );
      }
    );

    globalThis.fetch = fetchMock;

    const provider = createOpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-5.4",
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

    expect(result.content).toBe("Done.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
