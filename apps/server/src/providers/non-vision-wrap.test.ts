import { describe, expect, test } from "bun:test";
import type { ProviderClient } from "@nakama/core";
import { wrapProviderForNonVision } from "./non-vision-wrap";

describe("wrapProviderForNonVision", () => {
  test("converts described image parts before generateChat", async () => {
    const seen: unknown[] = [];
    const provider: ProviderClient = {
      async generateChat(input) {
        seen.push(input.messages.at(-1)?.content);
        return {
          assistantMessage: { content: "ok", role: "assistant" },
          content: "ok",
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

    await wrapProviderForNonVision(provider).generateChat({
      messages: [
        {
          content: [
            {
              data: "abc",
              description: "A chart.",
              mediaType: "image/png",
              type: "image",
            },
          ],
          role: "user",
        },
      ],
      system: "system",
    });

    expect(seen[0]).toBe("[Image]\nA chart.");
  });
});
