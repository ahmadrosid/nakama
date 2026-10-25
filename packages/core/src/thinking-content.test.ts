import { describe, expect, test } from "bun:test";
import {
  extractThinkingFromAssistantMessage,
  extractThinkingFromProviderContent,
} from "./thinking-content";

describe("extractThinkingFromProviderContent", () => {
  test("joins OpenAI reasoning summaries", () => {
    const text = extractThinkingFromProviderContent([
      {
        summary: [{ text: "Reasoning trace.", type: "summary_text" }],
        type: "reasoning",
      },
    ]);

    expect(text).toBe("Reasoning trace.");
  });
});

describe("extractThinkingFromAssistantMessage", () => {
  test("prefers direct thinking field", () => {
    const text = extractThinkingFromAssistantMessage({
      content: "Hi",
      providerContent: [{ thinking: "Ignored", type: "thinking" }],
      role: "assistant",
      thinking: "Direct trace",
    });

    expect(text).toBe("Direct trace");
  });
});
