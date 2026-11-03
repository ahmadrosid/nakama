import { afterEach, describe, expect, test } from "bun:test";
import { asTestFetch } from "../test-helpers";
import { createCommandCodeProvider } from "./index";

const ORIGINAL_FETCH = globalThis.fetch;

interface CapturedMessagesBody {
  output_config?: unknown;
  thinking?: unknown;
  tools?: Array<{ type?: string }>;
}

function mockFetch(
  handler: (request: Request) => Promise<Response> | Response
): void {
  const mockFn: typeof fetch = asTestFetch((input, init?) => {
    const request = new Request(input, init);

    return Promise.resolve(handler(request));
  });

  globalThis.fetch = mockFn;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("createCommandCodeProvider", () => {
  test("routes non-Claude models to the Chat Completions endpoint", async () => {
    let capturedUrl = "";

    mockFetch((request) => {
      capturedUrl = request.url;

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Hello from Command Code" } }],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    });

    const provider = createCommandCodeProvider({
      apiKey: "test",
      baseUrl: "https://proxy.example/v1",
      model: "deepseek/deepseek-v4.1-flash",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      system: "You are a helpful assistant.",
    });

    expect(provider.name).toBe("command_code");
    expect(capturedUrl).toBe("https://proxy.example/v1/chat/completions");
    expect(result.content).toBe("Hello from Command Code");
  });

  test("routes Claude models to the Anthropic Messages endpoint", async () => {
    let capturedUrl = "";

    mockFetch((request) => {
      capturedUrl = request.url;

      return new Response(
        JSON.stringify({
          content: [{ text: "Hello from messages", type: "text" }],
          id: "msg_test",
          model: "claude-sonnet-4-6",
          role: "assistant",
          stop_reason: "end_turn",
          type: "message",
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    });

    const provider = createCommandCodeProvider({
      apiKey: "test",
      model: "claude-sonnet-4-6",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      system: "You are a helpful assistant.",
    });

    expect(provider.name).toBe("command_code");
    expect(capturedUrl).toBe("https://api.commandcode.ai/provider/v1/messages");
    expect(result.content).toBe("Hello from messages");
  });

  test("keeps thinking and web search on Claude models", async () => {
    let capturedUrl = "";
    let capturedBody: CapturedMessagesBody = {};

    mockFetch(async (request) => {
      capturedUrl = request.url;

      capturedBody = await request.json();

      return new Response(
        JSON.stringify({
          content: [{ text: "Hello from messages", type: "text" }],
          id: "msg_test",
          model: "claude-sonnet-4-6",
          role: "assistant",
          stop_reason: "end_turn",
          type: "message",
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    });

    const provider = createCommandCodeProvider({
      apiKey: "test",
      baseUrl: "https://proxy.example/v1",
      model: "claude-sonnet-4-6",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      providerOptions: {
        thinking: { effort: "medium", enabled: true },
        webSearch: true,
      },
      system: "You are a helpful assistant.",
    });

    expect(capturedUrl).toBe("https://proxy.example/v1/messages");
    expect(capturedBody.thinking).toEqual({ type: "adaptive" });
    expect(capturedBody.output_config).toEqual({ effort: "medium" });
    expect(
      capturedBody.tools?.some((tool) => tool.type === "web_search_20250305")
    ).toBe(true);
    expect(result.content).toBe("Hello from messages");
  });
});
