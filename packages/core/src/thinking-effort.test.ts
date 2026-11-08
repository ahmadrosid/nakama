import { describe, expect, test } from "bun:test";

import {
  clampThinkingEffort,
  extraThinkingEfforts,
  isThinkingEffort,
} from "./thinking-effort";

describe("extraThinkingEfforts", () => {
  const cases: [string, string[]][] = [
    ["@cf/deepseek-ai/deepseek-v4.1-flash-1017", ["max"]],
    ["cb/deepseek-v4.1-flash", ["max"]],
    ["deepseek-flash", ["max"]],
    ["zai-glm-5.3-flash", ["max"]],
    ["kimi-k3", ["max"]],
    ["cx/gpt-6-luna", ["xhigh", "max"]],
    ["gpt-5.6-sol", ["xhigh", "max"]],
    ["gpt-5.4", ["xhigh"]],
    ["gpt-5.2-codex", ["xhigh"]],
    ["gpt-5.1", []],
    ["gpt-5-2025-08-07", []],
    ["glm-5-2026-01-01", []],
    ["accounts/fireworks/models/glm-5p2", ["max"]],
    ["gpt-5-mini", []],
    ["claude-opus-5-5", ["xhigh", "max"]],
    ["anthropic/claude-opus-4.7", ["xhigh", "max"]],
    ["claude-opus-4-6", ["max"]],
    ["claude-opus-4-5", []],
    ["grok-4.7", ["xhigh"]],
    ["grok-4.5", []],
    ["google/gemini-3.6-flash", []],
    ["llama-3.3-70b", []],
  ];

  test.each(cases)("%s", (model, expected) => {
    expect<string[]>(extraThinkingEfforts(model)).toEqual(expected);
  });
});

describe("clampThinkingEffort", () => {
  test.each([
    ["@cf/deepseek-ai/deepseek-v4.1-flash-1017", "max", "max"],
    ["@cf/deepseek-ai/deepseek-v4.1-flash-1017", "xhigh", "high"],
    ["cx/gpt-6-luna", "max", "max"],
    ["gpt-5.4", "max", "xhigh"],
    ["gpt-5.1", "xhigh", "high"],
    ["claude-opus-4-6", "xhigh", "high"],
    ["claude-opus-4-6", "max", "max"],
    ["google/gemini-3.6-flash", "max", "high"],
    ["google/gemini-3.6-flash", "low", "low"],
    ["llama-3.3-70b", "medium", "medium"],
  ] as const)("%s at %s -> %s", (model, effort, expected) => {
    expect(clampThinkingEffort(effort, model)).toBe(expected);
  });
});

test("isThinkingEffort rejects values outside the five levels", () => {
  expect(isThinkingEffort("max")).toBe(true);
  expect(isThinkingEffort("ultra")).toBe(false);
  expect(isThinkingEffort(null)).toBe(false);
});
