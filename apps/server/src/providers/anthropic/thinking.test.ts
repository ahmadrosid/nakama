import { describe, expect, test } from "bun:test";
import { parseAnthropicContent } from "./index";

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
