import { describe, expect, test } from "bun:test";
import type { WASocket } from "@whiskeysockets/baileys";
import { createTypingLoop } from "./typing-indicator";

const JID = "628100000000@s.whatsapp.net";

/** Drain the serialized typing promise chain. */
async function flushTypingChain(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function createFakeSocket() {
  const calls: string[] = [];
  const socket = {
    async sendPresenceUpdate(presence: string) {
      calls.push(presence);
    },
  } as unknown as WASocket;
  return { calls, socket };
}

function createBlockingSocket() {
  const releases: Array<() => void> = [];
  let sendCount = 0;
  const socket = {
    async sendPresenceUpdate() {
      sendCount += 1;
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    },
  } as unknown as WASocket;

  return {
    getSendCount: () => sendCount,
    releaseAll: () => {
      for (const release of releases.splice(0)) {
        release();
      }
    },
    socket,
  };
}

describe("createTypingLoop", () => {
  test("stop prevents later ping from sending presence", async () => {
    const { calls, socket } = createFakeSocket();
    const loop = createTypingLoop(socket, JID);

    loop.start();
    await flushTypingChain();
    expect(calls).toEqual(["composing"]);

    loop.stop();
    loop.ping();
    await flushTypingChain();

    expect(calls).toEqual(["composing"]);
  });

  test("start replaces a previous interval without leaking", async () => {
    const { calls, socket } = createFakeSocket();
    const loop = createTypingLoop(socket, JID);

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

  test("stop drops queued presence sends that have not started yet", async () => {
    const { getSendCount, releaseAll, socket } = createBlockingSocket();
    const loop = createTypingLoop(socket, JID);

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

    // Queued pings must not call WhatsApp after stop().
    expect(getSendCount()).toBe(1);
  });
});
