import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createAgentChatSession } from "@nakama/agent";
import {
  persistInlineAttachmentsInContent,
  rehydrateMessagesForProvider,
  type SaveInlineAttachmentInput,
} from "@nakama/core";
import { streamFromChunks } from "../test-helpers";
import { createChatgptProvider } from "./index";
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
  test.each([
    { enabled: false, streaming: false },
    { enabled: true, streaming: false },
    { enabled: false, streaming: true },
    { enabled: true, streaming: true },
  ])(
    "sends GPT-6.1 Sol tools through OAuth Responses (stream: $streaming, thinking: $enabled)",
    async ({ enabled, streaming }) => {
      const bodies: Array<Record<string, unknown>> = [];
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        expect(String(input)).toBe(`${CHATGPT_CODEX_BASE_URL}/responses`);
        bodies.push(JSON.parse(String(init?.body)));
        return textStreamResponse("Done");
      }) as typeof fetch;
      const provider = createChatgptProvider({
        getOAuth: validOauth,
        model: "gpt-6.1-sol",
      });
      const request = {
        messages: [{ content: "Search", role: "user" as const }],
        providerOptions: { thinking: { effort: "high" as const, enabled } },
        system: "Be helpful.",
        tools: [
          {
            description: "Search files",
            name: "search_files",
            parameters: { properties: {}, type: "object" },
          },
        ],
      };

      const result = streaming
        ? await provider.streamChat(request, { onChunk: () => {} })
        : await provider.generateChat(request);
      expect(result.content).toBe("Done");

      expect(bodies[0]).toMatchObject({
        model: "gpt-6.1-sol",
        stream: true,
        tools: [
          {
            description: "Search files",
            name: "search_files",
            type: "function",
          },
        ],
      });
      expect(bodies[0]?.reasoning).toEqual(
        enabled ? { effort: "high", summary: "auto" } : undefined
      );
      expect(bodies[0]?.reasoning_effort).toBeUndefined();
    }
  );

  test.each([
    { kind: "pdf", streaming: false },
    { kind: "pdf", streaming: true },
    { kind: "png", streaming: false },
    { kind: "png", streaming: true },
  ])(
    "sends stored $kind bytes to ChatGPT (stream: $streaming)",
    async ({ kind, streaming }) => {
      const pdf = readFileSync(
        new URL(
          "../../../../../packages/core/src/__fixtures__/sample.pdf",
          import.meta.url
        )
      ).toString("base64");
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const saved = new Map<string, SaveInlineAttachmentInput>();
      const fetchMock = mock(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          expect(String(url)).toBe(`${CHATGPT_CODEX_BASE_URL}/responses`);
          const body = JSON.parse(String(init?.body));
          expect(body.stream).toBe(true);
          expect(body.input).toEqual([
            {
              content: [
                kind === "pdf"
                  ? {
                      file_data: `data:application/pdf;base64,${pdf}`,
                      filename: "receipt.pdf",
                      type: "input_file",
                    }
                  : {
                      image_url: `data:image/png;base64,${png}`,
                      type: "input_image",
                    },
              ],
              role: "user",
              type: "message",
            },
          ]);
          return textStreamResponse("Received");
        }
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const session = createAgentChatSession(
        {
          provider: createChatgptProvider({
            getOAuth: validOauth,
            model: "gpt-5.4",
          }),
        },
        {
          channel: "whatsapp",
          preprocessUserContent: (content) =>
            persistInlineAttachmentsInContent(content, async (attachment) => {
              const attachmentId = `att-${saved.size}`;
              saved.set(attachmentId, attachment);
              return { attachmentId, size: attachment.bytes.length };
            }),
          rehydrateMessagesForProvider: (messages) =>
            rehydrateMessagesForProvider(
              messages,
              async (id) => saved.get(id) ?? null
            ),
        }
      );
      const input = {
        ...(kind === "pdf"
          ? {
              documents: [
                {
                  data: pdf,
                  filename: "receipt.pdf",
                  mediaType: "application/pdf",
                },
              ],
            }
          : { images: [{ data: png, mediaType: "image/png" }] }),
        message: "",
      };
      const chunks: string[] = [];
      const reply = streaming
        ? await session.sendStream(input, {
            onChunk: (chunk) => chunks.push(chunk),
          })
        : await session.send(input);
      expect(reply).toBe("Received");
      if (streaming) {
        expect(chunks.join("")).toBe("Received");
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(session.getHistory()[0]?.content).toEqual([
        kind === "pdf"
          ? {
              attachmentId: "att-0",
              filename: "receipt.pdf",
              mediaType: "application/pdf",
              size: Buffer.from(pdf, "base64").length,
              type: "document_ref",
            }
          : {
              attachmentId: "att-0",
              mediaType: "image/png",
              size: Buffer.from(png, "base64").length,
              type: "image_ref",
            },
      ]);
    }
  );

  test.each(["gpt-5.4", "gpt-6.1-sol"])(
    "%s generateText streams a Responses chat turn",
    async (model) => {
      const fetchMock = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(String(input)).toBe(`${CHATGPT_CODEX_BASE_URL}/responses`);
          const body = JSON.parse(String(init?.body));
          expect(body.model).toBe(model);
          expect(body.reasoning).toBeUndefined();
          expect(body.reasoning_effort).toBeUndefined();
          expect(body.tools).toBeUndefined();
          expect(body.stream).toBe(true);
          expect(body.instructions).toContain("You write titles.");
          expect(body.instructions).toContain(
            "Return only the requested text."
          );
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
        model,
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
    }
  );

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
});
