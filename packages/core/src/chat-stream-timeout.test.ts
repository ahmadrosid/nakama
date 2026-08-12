import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CHAT_FIRST_TOKEN_TIMEOUT_MS,
  MIN_CHAT_FIRST_TOKEN_TIMEOUT_MS,
  resolveChatFirstTokenTimeoutMs,
} from "./chat-stream-timeout";

describe("resolveChatFirstTokenTimeoutMs", () => {
  test("falls back to the default when unset or unparseable", () => {
    expect(resolveChatFirstTokenTimeoutMs({})).toBe(
      DEFAULT_CHAT_FIRST_TOKEN_TIMEOUT_MS
    );
    expect(
      resolveChatFirstTokenTimeoutMs({
        NAKAMA_CHAT_FIRST_TOKEN_TIMEOUT_MS: " ",
      })
    ).toBe(DEFAULT_CHAT_FIRST_TOKEN_TIMEOUT_MS);
    expect(
      resolveChatFirstTokenTimeoutMs({
        NAKAMA_CHAT_FIRST_TOKEN_TIMEOUT_MS: "soon",
      })
    ).toBe(DEFAULT_CHAT_FIRST_TOKEN_TIMEOUT_MS);
  });

  test("takes an explicit value and floors it at the minimum", () => {
    expect(
      resolveChatFirstTokenTimeoutMs({
        NAKAMA_CHAT_FIRST_TOKEN_TIMEOUT_MS: "45000",
      })
    ).toBe(45_000);
    expect(
      resolveChatFirstTokenTimeoutMs({
        NAKAMA_CHAT_FIRST_TOKEN_TIMEOUT_MS: "1",
      })
    ).toBe(MIN_CHAT_FIRST_TOKEN_TIMEOUT_MS);
  });

  test("zero or negative disables the deadline rather than clamping it", () => {
    // The escape hatch for a deployment whose model thinks for minutes before
    // emitting anything. Clamping here would leave no way to turn it off.
    expect(
      resolveChatFirstTokenTimeoutMs({
        NAKAMA_CHAT_FIRST_TOKEN_TIMEOUT_MS: "0",
      })
    ).toBe(0);
    expect(
      resolveChatFirstTokenTimeoutMs({
        NAKAMA_CHAT_FIRST_TOKEN_TIMEOUT_MS: "-1",
      })
    ).toBe(0);
  });
});
