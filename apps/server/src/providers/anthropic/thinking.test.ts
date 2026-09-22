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
      const provider = createAnthropicProvider({
        apiKey: "test-key",
        fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
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
      expect(body.max_tokens).toBe(4096);
      if (model === "claude-opus-5") {
        expect(
          (
            await provider.generateText({
              format: "text",
              prompt: "Hello",
              system: "Be helpful.",
            })
          ).content
        ).toBe("Hello.");
        expect(body.thinking).toEqual({ type: "disabled" });
        expect(body.output_config).toBeUndefined();
        expect(body.max_tokens).toBe(2048);
      }
    }
  );
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
