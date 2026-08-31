import { describe, expect, test } from "bun:test";
import { createTypingLoop } from "./channel-typing-loop";

/** Drain the serialized typing promise chain. */
async function flushTypingChain(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function createRecordingSend() {
  const calls: string[] = [];
  return {
    calls,
    send: async () => {
      calls.push("typing");
    },
  };
}

function createBlockingSend() {
  const releases: Array<() => void> = [];
  let sendCount = 0;

  return {
    getSendCount: () => sendCount,
    releaseAll: () => {
      for (const release of releases.splice(0)) {
        release();
      }
    },
    send: async () => {
      sendCount += 1;
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    },
  };
}

describe("createTypingLoop", () => {
  test("stop prevents later ping from sending", async () => {
    const { calls, send } = createRecordingSend();
    const loop = createTypingLoop(send, 4000);

    loop.start();
    await flushTypingChain();
    expect(calls).toEqual(["typing"]);

    loop.stop();
    loop.ping();
    await flushTypingChain();

    expect(calls).toEqual(["typing"]);
  });

  test("start replaces a previous interval without leaking", async () => {
    const { calls, send } = createRecordingSend();
    const loop = createTypingLoop(send, 4000);

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

  test("stop drops queued sends that have not started yet", async () => {
    const { getSendCount, releaseAll, send } = createBlockingSend();
    const loop = createTypingLoop(send, 4000);

    loop.start();
    await flushTypingChain();
    expect(getSendCount()).toBe(1);

    // Flood like onThinking / onToolStart deltas during a long generation.
    loop.ping();
    loop.ping();
    loop.ping();
    await flushTypingChain();
    // Serialized: only the first send is in flight.
    expect(getSendCount()).toBe(1);

    loop.stop();
    releaseAll();
    await flushTypingChain();

    // Queued pings must not reach the channel after stop().
    expect(getSendCount()).toBe(1);
  });

  test("refreshes on the interval it was given", async () => {
    const { calls, send } = createRecordingSend();
    const loop = createTypingLoop(send, 5);

    loop.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    loop.stop();

    // The callers pass different values (4000 Telegram, 8000 Discord), so the
    // interval has to stay a parameter rather than a constant in here.
    expect(calls.length).toBeGreaterThan(1);
  });
});
