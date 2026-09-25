import { afterEach, describe, expect, mock, test } from "bun:test";
import { streamFromChunks } from "../test-helpers";
import { createChatgptProvider, getChatgptAccountCooldowns } from "./index";
import { CHATGPT_CODEX_BASE_URL } from "./oauth";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function validOauth() {
  return {
    accessToken: "access-token",
    accountId: "acct_1",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refreshToken: "refresh-token",
  };
}

function oauth(accountId: string) {
  return { ...validOauth(), accountId };
}

function textStreamResponse(text: string) {
  return new Response(
    streamFromChunks([
      `data:${JSON.stringify({ delta: text, type: "response.output_text.delta" })}\r\n\r\n`,
      `data:${JSON.stringify({
        item: {
          content: [{ text, type: "output_text" }],
          id: "msg_1",
          type: "message",
        },
        type: "response.output_item.done",
      })}\r\n\r\n`,
      `data:${JSON.stringify({
        response: {
          usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
        },
        type: "response.completed",
      })}\r\n\r\n`,
    ]),
    { headers: { "Content-Type": "text/event-stream" }, status: 200 }
  );
}

describe("createChatgptProvider", () => {
  test("generateText streams a Responses chat turn", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(`${CHATGPT_CODEX_BASE_URL}/responses`);
        const body = JSON.parse(String(init?.body));
        expect(body.stream).toBe(true);
        expect(body.instructions).toContain("You write titles.");
        expect(body.instructions).toContain("Return only the requested text.");
        expect(body.input).toEqual([
          { content: "User: Plan a migration", role: "user" },
        ]);
        expect(body.text).toBeUndefined();

        return textStreamResponse("Migration Plan");
      }
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createChatgptProvider({
      getOAuth: validOauth,
      model: "gpt-5.4",
    });

    const result = await provider.generateText({
      format: "text",
      prompt: "User: Plan a migration",
      system: "You write titles.",
    });

    expect(result.content).toBe("Migration Plan");
    expect(result.usage).toEqual({
      inputTokens: 8,
      outputTokens: 3,
      totalTokens: 11,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("generateText asks for JSON in the system prompt by default", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.stream).toBe(true);
        expect(body.instructions).toContain("Respond with valid JSON only.");
        expect(body.text).toBeUndefined();

        return textStreamResponse('{"title":"ok"}');
      }
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createChatgptProvider({
      getOAuth: validOauth,
      model: "gpt-5.4",
    });

    const result = await provider.generateText({
      prompt: "Draft JSON",
      system: "You write JSON.",
    });

    expect(result.content).toBe('{"title":"ok"}');
  });

  test("retries a rate-limited account on the next connected account", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("gpt-5.4");
        expect(body.input).toEqual([{ content: "hello", role: "user" }]);
        if (new Headers(init?.headers).get("ChatGPT-Account-ID") === "acct_1") {
          return new Response(
            JSON.stringify({
              error: { code: "usage_limit_exceeded", message: "limit" },
            }),
            { status: 429 }
          );
        }
        return textStreamResponse("served by B");
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createChatgptProvider({
      fallbacks: [
        {
          getOAuth: () => oauth("acct_2"),
          instanceId: "instance-b",
          label: "Account B",
          model: "gpt-5.4",
        },
      ],
      getOAuth: () => oauth("acct_1"),
      instanceId: "instance-a",
      label: "Account A",
      model: "gpt-5.4",
    });
    const result = await provider.generateChat({
      messages: [{ content: "hello", role: "user" }],
      system: "test",
    });

    expect(result.content).toBe("served by B");
    expect(result.usage?.providerInstanceId).toBe("instance-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getChatgptAccountCooldowns()["instance-a"]).toBeGreaterThan(
      Date.now()
    );
  });

  test("does not retry a Responses failure after streamed output", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (new Headers(init?.headers).get("ChatGPT-Account-ID") === "acct_1") {
          return new Response(
            streamFromChunks([
              `data:${JSON.stringify({ delta: "partial", type: "response.output_text.delta" })}\n\n`,
              `data:${JSON.stringify({ error: { code: "usage_limit_exceeded", message: "limit" }, type: "response.failed" })}\n\n`,
            ]),
            { headers: { "Content-Type": "text/event-stream" }, status: 200 }
          );
        }
        return textStreamResponse("must not be used");
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const provider = createChatgptProvider({
      fallbacks: [{ getOAuth: () => oauth("acct_2"), model: "gpt-5.4" }],
      getOAuth: () => oauth("acct_1"),
      model: "gpt-5.4",
    });
    const chunks: string[] = [];

    await expect(
      provider.streamChat(
        { messages: [{ content: "hello", role: "user" }], system: "test" },
        { onChunk: (chunk) => chunks.push(chunk) }
      )
    ).rejects.toThrow("limit");

    expect(chunks).toEqual(["partial"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
