import { afterEach, describe, expect, mock, test } from "bun:test";
import { createOpenAIProvider } from "./index";
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

  test("allows gpt-5 models", () => {
    expect(openAIModelSupportsThinking("gpt-5.4")).toBe(true);
    expect(openAIModelSupportsThinking("gpt-5.3-codex")).toBe(true);
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
  test("flags gpt-5.4+ chat completions tool restriction", () => {
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-5.4")).toBe(true);
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-5.6-luna")).toBe(true);
    expect(openAIModelRejectsChatToolsWithReasoning("GPT-5.6-Sol")).toBe(true);
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-5.3")).toBe(false);
    expect(openAIModelRejectsChatToolsWithReasoning("gpt-4o-mini")).toBe(false);
  });
});

describe("OpenAI codex vision routing", () => {
  test("routes codex image requests through the responses api", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api.openai.com/v1/responses");

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
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

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
  test("routes gpt-5.6-luna tool calls through responses even without thinking", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/responses");
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

    globalThis.fetch = fetchMock as unknown as typeof fetch;

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

    globalThis.fetch = fetchMock as unknown as typeof fetch;

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
