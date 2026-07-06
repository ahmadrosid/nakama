import { describe, expect, test } from "bun:test";
import type { ProviderClient } from "@nakama/core";
import { wrapProviderForNonVision } from "./non-vision-wrap";

describe("wrapProviderForNonVision", () => {
  test("converts described image parts before generateChat", async () => {
    const seen: unknown[] = [];
    const provider: ProviderClient = {
      name: "openai_compatible",
      async generateText() {
        return { content: "unused" };
      },
      async generateChat(input) {
        seen.push(input.messages.at(-1)?.content);
        return {
          content: "ok",
          toolCalls: [],
          assistantMessage: { role: "assistant", content: "ok" },
        };
      },
      async streamChat(input, handlers) {
        const result = await this.generateChat(input);
        handlers.onChunk(result.content);
        return result;
      },
    };

    await wrapProviderForNonVision(provider).generateChat({
      system: "system",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              mediaType: "image/png",
              data: "abc",
              description: "A chart.",
            },
          ],
        },
      ],
    });

    expect(seen[0]).toBe("[Image]\nA chart.");
  });
});
