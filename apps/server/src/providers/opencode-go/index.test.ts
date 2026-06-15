import { describe, expect, test, afterEach } from "bun:test";
import { createOpenCodeGoProvider } from "./index";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (request: Request) => Promise<Response> | Response): void {
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
  test("returns a provider named opencode_go", () => {
    const provider = createOpenCodeGoProvider({ apiKey: "test" });
    expect(provider.name).toBe("opencode_go");
  });

  test("routes chat-completions models to the OpenAI-compatible endpoint", async () => {
    let capturedUrl: string | null = null;

    mockFetch((request) => {
      capturedUrl = request.url;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Hello from OpenCode Go" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const provider = createOpenCodeGoProvider({
      apiKey: "test",
      model: "opencode-go/kimi-k2.7-code",
    });

    const result = await provider.generateChat({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hi" }],
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
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "opencode-go/qwen3.7-max",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Hello from messages" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const provider = createOpenCodeGoProvider({
      apiKey: "test",
      model: "opencode-go/qwen3.7-max",
    });

    const result = await provider.generateChat({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(result.content).toBe("Hello from messages");
  });
});
