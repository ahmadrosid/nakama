import { afterEach, describe, expect, test } from "bun:test";
import { asTestFetch } from "../test-helpers";
import { createOpenCodeGoProvider, formatOpenCodeSessionId } from "./index";

const ORIGINAL_FETCH = globalThis.fetch;

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

describe("formatOpenCodeSessionId", () => {
  test("generates a random session id starting with ses_ when omitted", () => {
    const id = formatOpenCodeSessionId();
    expect(id).toMatch(/^ses_[a-f0-9]{32}$/);
  });

  test("preserves existing ses_ prefix", () => {
    expect(formatOpenCodeSessionId("ses_abc123")).toBe("ses_abc123");
  });

  test("sanitizes an id that already starts with ses_", () => {
    expect(formatOpenCodeSessionId("ses_x:y")).toBe("ses_x_y");
    expect(formatOpenCodeSessionId("ses_a\r\nb")).toBe("ses_a__b");
    expect(formatOpenCodeSessionId("ses_é")).toBe("ses__");
    expect(formatOpenCodeSessionId("ses_")).toMatch(/^ses_[a-f0-9]{32}$/);
  });

  test("bounds the id length", () => {
    expect(formatOpenCodeSessionId("a".repeat(200))).toBe(
      `ses_${"a".repeat(64)}`
    );
    expect(formatOpenCodeSessionId(`ses_${"b".repeat(200)}`)).toBe(
      `ses_${"b".repeat(64)}`
    );
  });

  test("prefixes with ses_ and sanitizes special characters", () => {
    expect(formatOpenCodeSessionId("org_1:session_123")).toBe(
      "ses_org_1_session_123"
    );
    expect(formatOpenCodeSessionId("dc7784c29b4f9b69")).toBe(
      "ses_dc7784c29b4f9b69"
    );
  });
});

describe("createOpenCodeGoProvider", () => {
  test("routes chat-completions models to the OpenAI-compatible endpoint with x-opencode-session", async () => {
    let capturedUrl = "";
    let capturedSessionHeader: string | null = null;

    mockFetch((request) => {
      capturedUrl = request.url;
      capturedSessionHeader = request.headers.get("x-opencode-session");

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
      sessionId: "session_abc",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      system: "You are a helpful assistant.",
    });

    expect(capturedUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(capturedSessionHeader).toBe("ses_session_abc");
    expect(result.content).toBe("Hello from OpenCode Go");
  });

  test("generates a default x-opencode-session header when sessionId is not provided", async () => {
    let capturedSessionHeader: string | null = null;
    const sessions: (string | null)[] = [];

    mockFetch((request) => {
      capturedSessionHeader = request.headers.get("x-opencode-session");
      sessions.push(capturedSessionHeader);

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK" } }],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    });

    const provider = createOpenCodeGoProvider({
      apiKey: "test",
      model: "opencode-go/kimi-k2.7-code",
    });

    await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      system: "You are a helpful assistant.",
    });

    expect(capturedSessionHeader).toMatch(/^ses_[a-f0-9]{32}$/);
    await provider.generateChat({
      messages: [{ content: "Again", role: "user" }],
      system: "You are a helpful assistant.",
    });
    expect(sessions).toEqual([capturedSessionHeader, capturedSessionHeader]);
  });

  test("routes messages models to the Anthropic-style endpoint with x-opencode-session", async () => {
    let capturedUrl = "";
    let capturedSessionHeader: string | null = null;

    mockFetch((request) => {
      capturedUrl = request.url;
      capturedSessionHeader = request.headers.get("x-opencode-session");

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
      sessionId: "ses_existing_123",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      system: "You are a helpful assistant.",
    });

    expect(capturedUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(capturedSessionHeader).toBe("ses_existing_123");
    expect(result.content).toBe("Hello from messages");
  });

  test.each([
    [
      "opencode-go/kimi-k2.7-code",
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n',
    ],
    [
      "opencode-go/qwen3.7-max",
      [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join(""),
    ],
  ])("streamChat sends the session header for %s", async (model, events) => {
    let capturedSessionHeader: string | null = null;

    mockFetch((request) => {
      capturedSessionHeader = request.headers.get("x-opencode-session");

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(events));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      });
    });

    const provider = createOpenCodeGoProvider({
      apiKey: "test",
      model,
      sessionId: "stream_test_sess",
    });

    let streamed = "";
    await provider.streamChat(
      {
        messages: [{ content: "Hi", role: "user" }],
        system: "You are a helpful assistant.",
      },
      {
        onChunk: (delta) => {
          streamed += delta;
        },
      }
    );

    expect(capturedSessionHeader).toBe("ses_stream_test_sess");
    expect(streamed).toBe("Hi");
  });
});
