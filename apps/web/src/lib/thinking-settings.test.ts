import { describe, expect, test } from "bun:test";
import { thinkingEffortOptionsFor } from "./thinking-settings";

const values = (model?: { id: string }) =>
  thinkingEffortOptionsFor(model).map((option) => option.value);

describe("thinkingEffortOptionsFor", () => {
  test("adds only the higher levels the active model accepts", () => {
    expect(values({ id: "deepseek/deepseek-v4.1-flash" })).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(values({ id: "cx/gpt-6-luna" })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(values({ id: "google/gemini-3.6-flash" })).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  test("keeps the base three when no model is selected", () => {
    expect(values()).toEqual(["low", "medium", "high"]);
  });
});
