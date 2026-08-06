import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CHAT_STREAM_TIMEOUT_MS,
  MAX_CHAT_STREAM_TIMEOUT_MS,
  MIN_CHAT_STREAM_TIMEOUT_MS,
  resolveChatStreamTimeoutMs,
} from "./chat-stream-timeout";

describe("resolveChatStreamTimeoutMs", () => {
  test("defaults to 30 minutes", () => {
    expect(resolveChatStreamTimeoutMs({})).toBe(DEFAULT_CHAT_STREAM_TIMEOUT_MS);
    expect(DEFAULT_CHAT_STREAM_TIMEOUT_MS).toBe(1_800_000);
  });

  test("reads NAKAMA_CHAT_STREAM_TIMEOUT_MS", () => {
    expect(
      resolveChatStreamTimeoutMs({ NAKAMA_CHAT_STREAM_TIMEOUT_MS: "900000" }),
    ).toBe(900_000);
  });

  test("clamps invalid and out-of-range values", () => {
    expect(resolveChatStreamTimeoutMs({ NAKAMA_CHAT_STREAM_TIMEOUT_MS: "abc" })).toBe(
      DEFAULT_CHAT_STREAM_TIMEOUT_MS,
    );
    expect(
      resolveChatStreamTimeoutMs({ NAKAMA_CHAT_STREAM_TIMEOUT_MS: "1000" }),
    ).toBe(MIN_CHAT_STREAM_TIMEOUT_MS);
    expect(
      resolveChatStreamTimeoutMs({ NAKAMA_CHAT_STREAM_TIMEOUT_MS: "999999999" }),
    ).toBe(MAX_CHAT_STREAM_TIMEOUT_MS);
  });
});
