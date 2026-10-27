import { describe, expect, test } from "bun:test";
import {
  addChatUsage,
  CHAT_USAGE_VISIBLE_KEY,
  getInitialChatUsageVisible,
  sumChatUsage,
} from "./chat-usage";

describe("chat usage", () => {
  test("sums tokens and keeps cost only when every side has one", () => {
    const priced = addChatUsage(
      { costUsd: 0.001, inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      { costUsd: 0.002, inputTokens: 200, outputTokens: 20, totalTokens: 220 }
    );

    expect(priced).toEqual({
      costUsd: 0.003,
      inputTokens: 300,
      outputTokens: 30,
      totalTokens: 330,
    });

    const unpriced = addChatUsage(priced, {
      estimated: true,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });

    expect(unpriced).toEqual({
      estimated: true,
      inputTokens: 301,
      outputTokens: 31,
      totalTokens: 332,
    });
  });

  test("sumChatUsage only counts assistant messages", () => {
    expect(
      sumChatUsage([
        { role: "user" },
        {
          role: "assistant",
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
        },
        { role: "tool" },
        {
          role: "assistant",
          usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
        },
      ])
    ).toEqual({ inputTokens: 12, outputTokens: 3, totalTokens: 15 });
    expect(sumChatUsage([{ role: "assistant" }])).toBeUndefined();
  });

  test("hides token usage until the setting is turned on", () => {
    const previous = globalThis.localStorage;
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });

    try {
      expect(getInitialChatUsageVisible()).toBe(false);
      store.set(CHAT_USAGE_VISIBLE_KEY, "true");
      expect(getInitialChatUsageVisible()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
    }
  });
});
