import { describe, expect, test } from "bun:test";
import {
  extractThinkingFromAssistantMessage,
  extractThinkingFromProviderContent,
} from "./thinking-content";

describe("extractThinkingFromProviderContent", () => {
  test("joins Anthropic thinking blocks", () => {
    const text = extractThinkingFromProviderContent([
      { thinking: "Step one.", type: "thinking" },
      { text: "Answer.", type: "text" },
    ]);

    expect(text).toBe("Step one.");
  });

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
