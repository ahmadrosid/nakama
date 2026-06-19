import { describe, expect, test } from "bun:test";
import type { ProviderClient } from "@tinyclaw/core";
import { createAgentHarness } from "./index";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("preprocessUserContent vision fallback", () => {
  test("replaces images before the primary provider sees them", async () => {
    const calls: Array<string | { type: string }[]> = [];
    const provider: ProviderClient = {
      name: "openai_compatible",
      async generateText() {
        return "unused";
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

    const harness = createAgentHarness({ provider });
    const session = harness.createChatSession({
      preprocessUserContent: async (content) => {
        if (typeof content === "string") {
          return content;
        }

        const hasImage = content.some((part) => part.type === "image");
        if (!hasImage) {
          return content;
        }

        return [
          { type: "text", text: "What is this?" },
          { type: "text", text: "[Image]\nA small red square." },
        ];
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
  });
});
