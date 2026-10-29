import { describe, expect, test } from "bun:test";
import { openRouterModelSupportsThinking } from "./thinking";

describe("openRouterModelSupportsThinking", () => {
  test("honors custom model supportsThinking override", () => {
    expect(
      openRouterModelSupportsThinking("some-vendor/some-model", [
        { id: "some-vendor/some-model", supportsThinking: true },
      ])
    ).toBe(true);

    expect(
      openRouterModelSupportsThinking("anthropic/claude-sonnet-4-6", [
        { id: "anthropic/claude-sonnet-4-6", supportsThinking: false },
      ])
    ).toBe(false);
  });

  test("denies Llama and unknown slugs by default", () => {
    for (const model of [
      "meta-llama/llama-4-maverick",
      "meta-llama/llama-3.3-70b",
      "some-vendor/some-model",
    ]) {
      expect(openRouterModelSupportsThinking(model)).toBe(false);
    }
  });
});
