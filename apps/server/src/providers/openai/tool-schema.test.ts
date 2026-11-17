import { afterEach, describe, expect, mock, test } from "bun:test";
import { asTestFetch, streamFromChunks } from "../test-helpers";
import { createOpenAIProvider } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAI provider tool schemas", () => {
  test("sends tool enums to OpenAI as published", async () => {
    let sentTools: unknown;

    globalThis.fetch = asTestFetch(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sentTools = JSON.parse(String(init?.body)).tools;

        return new Response(
          streamFromChunks([
            'data:{"choices":[{"delta":{"content":"Hi"}}]}\r\n\r\n',
            "data:[DONE]\r\n\r\n",
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        );
      })
    );

    const parameters = {
      properties: { mode: { enum: ["", "auto"], type: "string" } },
      type: "object",
    };

    await createOpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-4.1",
    }).streamChat(
      {
        messages: [{ content: "Plan", role: "user" }],
        system: "You are helpful.",
        tools: [{ description: "Plan", name: "plan", parameters }],
      },
      { onChunk: () => undefined }
    );

    expect(sentTools).toEqual([
      {
        function: { description: "Plan", name: "plan", parameters },
        type: "function",
      },
    ]);
  });
});
