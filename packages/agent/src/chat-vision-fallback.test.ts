import { describe, expect, test } from "bun:test";
import {
  replaceImagePartsWithDescriptions,
  resolveMessagesForNonVisionProvider,
  type ProviderClient,
} from "@tinyclaw/core";
import { createAgentHarness } from "./index";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("preprocessUserContent vision fallback", () => {
  test("stores described images and sends text to the primary provider", async () => {
    const calls: Array<string | { type: string }[]> = [];
    const provider: ProviderClient = {
      name: "openai_compatible",
      async generateText() {
        return { content: "unused" };
      },
      async generateChat(input) {
        calls.push(input.messages.at(-1)?.content ?? "");
        return {
          content: "A small red square.",
          toolCalls: [],
          assistantMessage: { role: "assistant", content: "A small red square." },
        };
      },
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
          handlers,
        );
      },
    };

    const harness = createAgentHarness({ provider: wrappedProvider });
    const session = harness.createChatSession({
      preprocessUserContent: async (content) => {
        if (typeof content === "string") {
          return content;
        }

        const hasImage = content.some((part) => part.type === "image");
        if (!hasImage) {
          return content;
        }

        return replaceImagePartsWithDescriptions(content, ["A small red square."]);
      },
    });

    const reply = await session.send({
      message: "What is this?",
      images: [{ mediaType: "image/png", data: tinyPngBase64 }],
    });

    expect(reply).toBe("A small red square.");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      { type: "text", text: "What is this?" },
      { type: "text", text: "[Image]\nA small red square." },
    ]);
    expect(session.getHistory()[0]?.content).toEqual([
      { type: "text", text: "What is this?" },
      {
        type: "image",
        mediaType: "image/png",
        data: tinyPngBase64,
        description: "A small red square.",
      },
    ]);
  });
});
