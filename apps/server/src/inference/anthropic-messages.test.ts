import { describe, expect, test } from "bun:test";
import type { ChatCompletionResult } from "@nakama/core";
import {
  anthropicRequestToGenerateChatInput,
  buildAnthropicMessageResponse,
  parseAnthropicMessagesRequest,
} from "./anthropic-messages";

describe("anthropic messages adapter", () => {
  test("parses requests and maps them into Nakama chat input", () => {
    const request = parseAnthropicMessagesRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: "System prompt",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(anthropicRequestToGenerateChatInput(request)).toEqual({
      system: "System prompt",
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  test("rejects tool calling until the gateway supports it", () => {
    expect(() =>
      parseAnthropicMessagesRequest({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
        tools: [{ name: "bash" }],
      }),
    ).toThrow("Tool calling is not supported");
  });

  test("wraps provider output in Anthropic message shape", () => {
    const request = parseAnthropicMessagesRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
    });
    const result: ChatCompletionResult = {
      content: "Done",
      toolCalls: [],
      assistantMessage: { role: "assistant", content: "Done" },
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    };

    expect(buildAnthropicMessageResponse(request, result)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      usage: { input_tokens: 3, output_tokens: 2 },
    });
  });
});
