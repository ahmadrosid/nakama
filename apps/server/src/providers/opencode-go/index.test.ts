import { afterEach, describe, expect, test } from "bun:test";
import { createOpenCodeGoProvider } from "./index";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(
  handler: (request: Request) => Promise<Response> | Response
): void {
  const mockFn: typeof fetch = (input, init?) => {
    const request = new Request(input, init);
    return Promise.resolve(handler(request));
  };
  globalThis.fetch = mockFn;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("createOpenCodeGoProvider", () => {
  test("routes chat-completions models to the OpenAI-compatible endpoint", async () => {
    let capturedUrl: string | null = null;

    mockFetch((request) => {
      capturedUrl = request.url;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Hello from OpenCode Go" } }],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    });

    const provider = createOpenCodeGoProvider({
      apiKey: "test",
      model: "opencode-go/kimi-k2.7-code",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      system: "You are a helpful assistant.",
    });

    expect(capturedUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(result.content).toBe("Hello from OpenCode Go");
  });

  test("routes messages models to the Anthropic-style endpoint", async () => {
    let capturedUrl: string | null = null;

    mockFetch((request) => {
      capturedUrl = request.url;
      return new Response(
        JSON.stringify({
          content: [{ text: "Hello from messages", type: "text" }],
          id: "msg_test",
          model: "opencode-go/qwen3.7-max",
          role: "assistant",
          stop_reason: "end_turn",
          type: "message",
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    });

    const provider = createOpenCodeGoProvider({
      apiKey: "test",
      model: "opencode-go/qwen3.7-max",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      system: "You are a helpful assistant.",
    });

    expect(capturedUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(result.content).toBe("Hello from messages");
  });
});
