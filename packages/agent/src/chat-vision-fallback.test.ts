import { describe, expect, test } from "bun:test";
import {
  type GenerateChatInput,
  type ProviderClient,
  persistInlineAttachmentsInContent,
  rehydrateMessagesForProvider,
  replaceImagePartsWithDescriptions,
  resolveMessagesForNonVisionProvider,
} from "@nakama/core";
import { createAgentChatSession } from "./index";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("preprocessUserContent vision fallback", () => {
  test.each(["reference", "description", "error"])(
    "preprocesses tool images using the existing %s path",
    async (mode) => {
      const calls: GenerateChatInput[] = [];
      const toolCalls = [
        { arguments: { path: "shot.png" }, id: "read1", name: "read_file" },
      ];
      const provider: ProviderClient = {
        async generateChat(input) {
          calls.push({
            ...input,
            messages: resolveMessagesForNonVisionProvider(input.messages),
          });
          return calls.length === 1
            ? {
                assistantMessage: { content: "", role: "assistant", toolCalls },
                content: "",
                toolCalls,
              }
            : {
                assistantMessage: { content: "done", role: "assistant" },
                content: "done",
                toolCalls: [],
              };
        },
        async generateText() {
          return { content: "unused" };
        },
        name: "openai_compatible",
        async streamChat(input) {
          return this.generateChat(input);
        },
      };
      const session = createAgentChatSession(
        {
          provider,
          tools: [
            {
              description: "Read",
              name: "read_file",
              async run() {
                return {
                  bytesRead: 70,
                  content: "Read image",
                  images: [{ data: tinyPngBase64, mediaType: "image/png" }],
                  path: "/workspace/shot.png",
                };
              },
            },
          ],
        },
        {
          async preprocessUserContent(content) {
            if (typeof content === "string") {
              return content;
            }
            if (mode === "error") {
              throw new Error("Vision unavailable");
            }
            if (mode === "description") {
              return replaceImagePartsWithDescriptions(content, [
                "A red square",
              ]);
            }
            return persistInlineAttachmentsInContent(content, async () => ({
              attachmentId: "saved-image",
              size: 70,
            }));
          },
          rehydrateMessagesForProvider: (messages) =>
            rehydrateMessagesForProvider(messages, async () => ({
              bytes: Buffer.from(tinyPngBase64, "base64"),
              mediaType: "image/png",
            })),
        }
      );
      expect(await session.send("Read it")).toBe("done");
      const tool = session
        .getHistory()
        .find((message) => message.role === "tool");
      if (tool?.role !== "tool") {
        throw new Error("Missing tool result");
      }
      const sent = calls[1]!.messages;
      if (mode === "error") {
        expect(JSON.parse(tool.content)).toMatchObject({
          bytesRead: 70,
          inspected: false,
          mediaType: "image/png",
          path: "/workspace/shot.png",
          reason: "Vision unavailable",
        });
        expect(JSON.parse(tool.content)).not.toHaveProperty("error");
        expect(JSON.stringify(sent)).not.toContain(tinyPngBase64);
        expect(tool.attachments).toBeUndefined();
        expect(sent.at(-1)?.role).toBe("tool");
      } else if (mode === "description") {
        expect(JSON.stringify(sent)).toContain("A red square");
        expect(JSON.stringify(sent)).not.toContain(tinyPngBase64);
      } else {
        expect(tool.attachments?.[0]).toMatchObject({
          attachmentId: "saved-image",
          type: "image_ref",
        });
        expect(JSON.stringify(tool)).not.toContain(tinyPngBase64);
        expect(JSON.stringify(sent)).toContain(tinyPngBase64);
        const resumed = createAgentChatSession(
          { provider },
          {
            initialHistory: JSON.parse(JSON.stringify(session.getHistory())),
            rehydrateMessagesForProvider: (messages) =>
              rehydrateMessagesForProvider(messages, async () => ({
                bytes: Buffer.from(tinyPngBase64, "base64"),
                mediaType: "image/png",
              })),
          }
        );
        await resumed.send("Look again");
        expect(JSON.stringify(calls[2]!.messages)).toContain(tinyPngBase64);
      }
    }
  );

  test("stores described images and sends text to the primary provider", async () => {
    const calls: Array<string | { type: string }[]> = [];
    const provider: ProviderClient = {
      async generateChat(input) {
        calls.push(input.messages.at(-1)?.content ?? "");
        return {
          assistantMessage: {
            content: "A small red square.",
            role: "assistant",
          },
          content: "A small red square.",
          toolCalls: [],
        };
      },
      async generateText() {
        return { content: "unused" };
      },
      name: "openai_compatible",
      async streamChat(input, handlers) {
        const result = await this.generateChat(input);
        handlers.onChunk(result.content);
        return result;
      },
    };

    const wrappedProvider: ProviderClient = {
      ...provider,
      async generateChat(input) {
        return provider.generateChat({
          ...input,
          messages: resolveMessagesForNonVisionProvider(input.messages),
        });
      },
      async streamChat(input, handlers) {
        return provider.streamChat(
          {
            ...input,
            messages: resolveMessagesForNonVisionProvider(input.messages),
          },
          handlers
        );
      },
    };

    const session = createAgentChatSession(
      { provider: wrappedProvider },
      {
        preprocessUserContent: async (content) => {
          if (typeof content === "string") {
            return content;
          }

          const hasImage = content.some((part) => part.type === "image");
          if (!hasImage) {
            return content;
          }

          return replaceImagePartsWithDescriptions(content, [
            "A small red square.",
          ]);
        },
      }
    );

    const reply = await session.send({
      images: [{ data: tinyPngBase64, mediaType: "image/png" }],
      message: "What is this?",
    });

    expect(reply).toBe("A small red square.");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      { text: "What is this?", type: "text" },
      { text: "[Image]\nA small red square.", type: "text" },
    ]);
    expect(session.getHistory()[0]?.content).toEqual([
      { text: "What is this?", type: "text" },
      {
        data: tinyPngBase64,
        description: "A small red square.",
        mediaType: "image/png",
        type: "image",
      },
    ]);
  });
});
