import { describe, expect, test } from "bun:test";
import { createTypingLoop } from "@nakama/core/channel-typing-loop";
import type { Context } from "grammy";

/** Drain the serialized typing promise chain. */
async function flushTypingChain(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function createFakeContext() {
  const calls: string[] = [];
  const ctx = {
    async replyWithChatAction(action: string) {
      calls.push(action);
    },
  } as unknown as Context;
  return { calls, ctx };
}

function createBlockingContext() {
  const releases: Array<() => void> = [];
  let sendCount = 0;
  const ctx = {
    async replyWithChatAction() {
      sendCount += 1;
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    },
  } as unknown as Context;

  return {
    ctx,
    getSendCount: () => sendCount,
    releaseAll: () => {
      for (const release of releases.splice(0)) {
        release();
      }
    },
  };
}

describe("createTypingLoop", () => {
  test("stop prevents later ping from sending typing", async () => {
    const { calls, ctx } = createFakeContext();
    const loop = createTypingLoop(() => ctx.replyWithChatAction("typing"));

    loop.start();
    await flushTypingChain();
    expect(calls).toEqual(["typing"]);

    loop.stop();
    loop.ping();
    await flushTypingChain();

    expect(calls).toEqual(["typing"]);
  });

  test("start replaces a previous interval without leaking", async () => {
    const { calls, ctx } = createFakeContext();
    const loop = createTypingLoop(() => ctx.replyWithChatAction("typing"));

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
    const { ctx, getSendCount, releaseAll } = createBlockingContext();
    const loop = createTypingLoop(() => ctx.replyWithChatAction("typing"));

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

    // Queued pings must not call Telegram after stop().
    expect(getSendCount()).toBe(1);
  });
});
