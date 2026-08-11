import { describe, expect, test } from "bun:test";
import type { DiscordMessenger } from "./messenger";
import { createTypingLoop } from "./typing-indicator";

/** Drain the serialized typing promise chain. */
async function flushTypingChain(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function createFakeMessenger() {
  const calls: string[] = [];
  const messenger: DiscordMessenger = {
    async edit() {},
    async send() {
      return null;
    },
    async sendTyping() {
      calls.push("typing");
    },
  };
  return { calls, messenger };
}

function createBlockingMessenger() {
  const releases: Array<() => void> = [];
  let sendCount = 0;
  const messenger: DiscordMessenger = {
    async edit() {},
    async send() {
      return null;
    },
    async sendTyping() {
      sendCount += 1;
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    },
  };

  return {
    getSendCount: () => sendCount,
    messenger,
    releaseAll: () => {
      for (const release of releases.splice(0)) {
        release();
      }
    },
  };
}

describe("createTypingLoop", () => {
  test("stop prevents later ping from sending typing", async () => {
    const { messenger, calls } = createFakeMessenger();
    const loop = createTypingLoop(messenger);

    loop.start();
    await flushTypingChain();
    expect(calls).toHaveLength(1);

    loop.stop();
    loop.ping();
    await flushTypingChain();

    expect(calls).toHaveLength(1);
  });

  test("start replaces a previous interval without leaking", async () => {
    const { messenger, calls } = createFakeMessenger();
    const loop = createTypingLoop(messenger);

    loop.start();
    await flushTypingChain();
    loop.start();
    await flushTypingChain();
    expect(calls).toHaveLength(2);

    loop.stop();
    loop.ping();
    await flushTypingChain();
    expect(calls).toHaveLength(2);
  });

  test("stop drops queued typing sends that have not started yet", async () => {
    const { getSendCount, messenger, releaseAll } = createBlockingMessenger();
    const loop = createTypingLoop(messenger);

    loop.start();
    await flushTypingChain();
    expect(getSendCount()).toBe(1);

    // Flood like onThinking deltas during a long generation.
    loop.ping();
    loop.ping();
    loop.ping();
    await flushTypingChain();
    // Serialized: only the first send is in flight.
    expect(getSendCount()).toBe(1);

    loop.stop();
    releaseAll();
    await flushTypingChain();

    // Queued pings must not call Discord after stop().
    expect(getSendCount()).toBe(1);
  });
});
