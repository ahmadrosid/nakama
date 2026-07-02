import { describe, expect, test } from "bun:test";
import { formatThinkingIndicator } from "./thinking-indicator";

describe("formatThinkingIndicator", () => {
  test("cycles through spinner frames", () => {
    expect(formatThinkingIndicator(0)).toEqual({
      segments: [{ text: " ⠋ Thinking ", style: { dim: true } }],
    });
    expect(formatThinkingIndicator(1)).toEqual({
      segments: [{ text: " ⠙ Thinking ", style: { dim: true } }],
    });
    expect(formatThinkingIndicator(10)).toEqual({
      segments: [{ text: " ⠋ Thinking ", style: { dim: true } }],
    });
  });
});
