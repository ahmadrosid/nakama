import { describe, expect, test } from "bun:test";
import { createAnthropicProvider, parseAnthropicContent } from "./index";

describe("Anthropic thinking requests", () => {
  test.each([
    ["claude-sonnet-5", true, { type: "adaptive" }, { effort: "low" }],
    ["claude-opus-5", true, { type: "adaptive" }, { effort: "low" }],
    ["claude-sonnet-4-6", true, { type: "adaptive" }, { effort: "low" }],
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
        providerOptions: { thinking: { effort: "low", enabled } },
        system: "Be helpful.",
      });
      expect(result.content).toBe("Hello.");
      expect(body.model).toBe(model);
      expect(body.thinking).toEqual(thinking);
      expect(body.output_config).toEqual(outputConfig);
      expect(body.max_tokens).toBe(4096);
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
