import { describe, expect, test } from "bun:test";
import { createAnthropicProvider, parseAnthropicContent } from "./index";

describe("Anthropic thinking requests", () => {
  test.each([
    [
      "claude-sonnet-5",
      true,
      { display: "summarized", type: "adaptive" },
      { effort: "low" },
    ],
    ["claude-sonnet-4-6", true, { type: "adaptive" }, { effort: "low" }],
    ["claude-sonnet-5", false, { type: "disabled" }, undefined],
    ["claude-opus-5", undefined, { type: "disabled" }, undefined],
    [
      "claude-opus-5-5",
      true,
      {
        block_binding: { prefix_mismatch_behavior: "drop_block" },
        type: "adaptive",
      },
      { effort: "low" },
    ],
    [
      "claude-opus-5-5",
      false,
      {
        block_binding: { prefix_mismatch_behavior: "drop_block" },
        type: "adaptive",
      },
      undefined,
    ],
    [
      "claude-opus-5-5",
      undefined,
      {
        block_binding: { prefix_mismatch_behavior: "drop_block" },
        type: "adaptive",
      },
      undefined,
    ],
    [
      "claude-haiku-4-5-20251001",
      true,
      { budget_tokens: 1024, type: "enabled" },
      undefined,
    ],
    [
      "claude-haiku-4-5",
      true,
      { budget_tokens: 1024, type: "enabled" },
      undefined,
    ],
    ["claude-haiku-4-5-20251001", false, undefined, undefined],
  ] as const)(
    "%s thinking enabled=%s",
    async (model, enabled, thinking, outputConfig) => {
      let body: Record<string, unknown> = {};
      let beta: string | null = null;
      const provider = createAnthropicProvider({
        apiKey: "test-key",
        fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
          beta = new Headers(init?.headers).get("anthropic-beta");
          return Response.json({
            content: [{ text: "Hello.", type: "text" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 3, output_tokens: 2 },
          });
        }) as typeof fetch,
        model,
      });
      const result = await provider.generateChat({
        messages: [{ content: "Hello", role: "user" }],
        providerOptions:
          enabled === undefined
            ? undefined
            : { thinking: { effort: "low", enabled } },
        system: "Be helpful.",
      });
      expect(result.content).toBe("Hello.");
      expect(body.model).toBe(model);
      expect(body.thinking).toEqual(thinking);
      expect(body.output_config).toEqual(outputConfig);
      expect(beta === "thinking-binding-controls-2026-08-01").toBe(
        model === "claude-opus-5-5"
      );
      expect(beta === null).toBe(model !== "claude-opus-5-5");
      expect(body.max_tokens).toBe(4096);
      if (model === "claude-opus-5" || model === "claude-opus-5-5") {
        expect(
          (
            await provider.generateText({
              format: "text",
              prompt: "Hello",
              system: "Be helpful.",
            })
          ).content
        ).toBe("Hello.");
        expect(body.thinking).toEqual(
          model === "claude-opus-5-5"
            ? {
                block_binding: { prefix_mismatch_behavior: "drop_block" },
                type: "adaptive",
              }
            : { type: "disabled" }
        );
        expect(body.output_config).toBeUndefined();
        expect(body.max_tokens).toBe(2048);
        expect(beta === "thinking-binding-controls-2026-08-01").toBe(
          model === "claude-opus-5-5"
        );
        expect(beta === null).toBe(model !== "claude-opus-5-5");
      }
    }
  );
});

test("Opus 5.5 replays signed thinking when the system prefix changes", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const provider = createAnthropicProvider({
    apiKey: "test-key",
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("anthropic-beta")).toBe(
        "thinking-binding-controls-2026-08-01"
      );
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({
        content: [{ text: "Done.", type: "text" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
      });
    }) as typeof fetch,
    model: "claude-opus-5-5",
  });
  const prior = {
    content: "First answer",
    providerContent: [
      { signature: "signed-block", thinking: "Private plan", type: "thinking" },
      { text: "First answer", type: "text" },
    ],
    role: "assistant" as const,
  };
  await provider.generateChat({
    messages: [{ content: "First", role: "user" }, prior],
    system: "Original prompt",
  });
  await provider.generateChat({
    messages: [
      { content: "First", role: "user" },
      prior,
      { content: "Next", role: "user" },
    ],
    system: "Updated prompt",
  });

  expect(requests[0]?.system).toBe("Original prompt");
  expect(requests[1]?.system).toBe("Updated prompt");
  expect(
    (requests[1]?.messages as Array<{ content: unknown }> | undefined)?.[1]
      ?.content
  ).toEqual(prior.providerContent);
  expect(requests[1]?.thinking).toEqual({
    block_binding: { prefix_mismatch_behavior: "drop_block" },
    type: "adaptive",
  });
});

describe("parseAnthropicContent", () => {
  test("keeps thinking out of assistant content", () => {
    const result = parseAnthropicContent([
      { thinking: "Plan the answer.", type: "thinking" },
      { text: "Hello.", type: "text" },
    ]);

    expect(result.content).toBe("Hello.");
    expect(result.assistantMessage.thinking).toBe("Plan the answer.");
  });
});
