import { describe, expect, test } from "bun:test";
import {
  type ProviderClient,
  replaceImagePartsWithDescriptions,
  resolveMessagesForNonVisionProvider,
} from "@nakama/core";
import { createAgentHarness } from "./index";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("preprocessUserContent vision fallback", () => {
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

        return replaceImagePartsWithDescriptions(content, [
          "A small red square.",
        ]);
      },
    });

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
