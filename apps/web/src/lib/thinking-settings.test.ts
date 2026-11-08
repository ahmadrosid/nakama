import { describe, expect, test } from "bun:test";
import type { ProviderModelOption } from "@nakama/core/contract";
import { thinkingEffortOptionsFor } from "./thinking-settings";

const values = (model?: Pick<ProviderModelOption, "id" | "provider">) =>
  thinkingEffortOptionsFor(model).map((option) => option.value);

describe("thinkingEffortOptionsFor", () => {
  test("adds only the higher levels the active model accepts", () => {
    expect(
      values({ id: "deepseek/deepseek-v4.1-flash", provider: "openrouter" })
    ).toEqual(["low", "medium", "high", "max"]);
    expect(values({ id: "gpt-6-luna", provider: "chatgpt" })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(
      values({ id: "google/gemini-3.6-flash", provider: "openrouter" })
    ).toEqual(["low", "medium", "high"]);
  });

  test("keeps the base three when no model is selected or the host stops at high", () => {
    expect(values()).toEqual(["low", "medium", "high"]);
    expect(
      values({ id: "deepseek-v4-flash:cloud", provider: "ollama" })
    ).toEqual(["low", "medium", "high"]);
  });
});
