import { describe, expect, test } from "bun:test";
import type { DiscordMessenger } from "./messenger";
import { createTypingLoop } from "./typing-indicator";

function createFakeMessenger() {
  const calls: string[] = [];
  const messenger: DiscordMessenger = {
    async send() {
      return null;
    },
    async edit() {},
    async sendTyping() {
      calls.push("typing");
    },
  };
  return { messenger, calls };
}

describe("createTypingLoop", () => {
  test("stop prevents later ping from sending typing", async () => {
    const { messenger, calls } = createFakeMessenger();
    const loop = createTypingLoop(messenger);

    loop.start();
    expect(calls).toHaveLength(1);

    loop.stop();
    loop.ping();

    expect(calls).toHaveLength(1);
  });

  test("start replaces a previous interval without leaking", () => {
    const { messenger, calls } = createFakeMessenger();
    const loop = createTypingLoop(messenger);

    loop.start();
    loop.start();
    expect(calls).toHaveLength(2);

    loop.stop();
    loop.ping();
    expect(calls).toHaveLength(2);
  });
});
