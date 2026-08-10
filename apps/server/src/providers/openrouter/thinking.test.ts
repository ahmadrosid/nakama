import { describe, expect, test } from "bun:test";
import { openRouterModelSupportsThinking } from "./thinking";

describe("openRouterModelSupportsThinking", () => {
  test("allows catalog Claude models", () => {
    expect(openRouterModelSupportsThinking("anthropic/claude-sonnet-4-6")).toBe(
      true
    );
  });

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

  test("denies catalog Llama model", () => {
    expect(openRouterModelSupportsThinking("meta-llama/llama-4-maverick")).toBe(
      false
    );
  });

  test("denies unknown custom Llama slugs", () => {
    expect(openRouterModelSupportsThinking("meta-llama/llama-3.3-70b")).toBe(
      false
    );
  });

  test("allows custom Claude slugs by prefix", () => {
    expect(openRouterModelSupportsThinking("anthropic/claude-3.7-sonnet")).toBe(
      true
    );
  });

  test("denies unknown custom slugs by default", () => {
    expect(openRouterModelSupportsThinking("some-vendor/some-model")).toBe(
      false
    );
  });
});
