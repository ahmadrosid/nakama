import { afterEach, describe, expect, test } from "bun:test";
import {
  clearActiveStream,
  hasActiveStreams,
  registerActiveStream,
  resetActiveStreamsForTests,
  stopActiveStream,
} from "./channel-active-stream";

afterEach(() => {
  resetActiveStreamsForTests();
});

describe("channel-active-stream", () => {
  test("registerActiveStream returns a signal and tracks the chat", () => {
    expect(hasActiveStreams()).toBe(false);

    const signal = registerActiveStream("chat-1");

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(hasActiveStreams()).toBe(true);
  });

  test("a new register aborts the previous controller for the same chat", () => {
    const first = registerActiveStream("chat-1");
    const second = registerActiveStream("chat-1");

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(hasActiveStreams()).toBe(true);
  });

  test("stale cleanup keeps the replacement stream registered", () => {
    const first = registerActiveStream("chat-1");
    const second = registerActiveStream("chat-1");

    clearActiveStream("chat-1", first);

    expect(stopActiveStream("chat-1")).toBe(true);
    expect(second.aborted).toBe(true);
  });

  test("clearActiveStream removes the chat", () => {
    const signal = registerActiveStream("chat-1");
    clearActiveStream("chat-1", signal);

    expect(hasActiveStreams()).toBe(false);
    expect(stopActiveStream("chat-1")).toBe(false);
  });

  test("stopActiveStream aborts and returns true only when present", () => {
    expect(stopActiveStream("missing")).toBe(false);

    const signal = registerActiveStream("chat-1");
    expect(stopActiveStream("chat-1")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(hasActiveStreams()).toBe(true);

    clearActiveStream("chat-1", signal);
    expect(hasActiveStreams()).toBe(false);
    expect(stopActiveStream("chat-1")).toBe(false);
  });

  test("hasActiveStreams reflects map size across chats", () => {
    const first = registerActiveStream("chat-1");
    const second = registerActiveStream("chat-2");
    expect(hasActiveStreams()).toBe(true);

    clearActiveStream("chat-1", first);
    expect(hasActiveStreams()).toBe(true);

    clearActiveStream("chat-2", second);
    expect(hasActiveStreams()).toBe(false);
  });
});
