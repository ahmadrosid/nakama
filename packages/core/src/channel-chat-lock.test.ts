import { describe, expect, test } from "bun:test";
import { createChatLock } from "./channel-chat-lock";

describe("createChatLock", () => {
  test("serializes work for the same key", async () => {
    const lock = createChatLock();
    const order: number[] = [];

    const first = lock.withLock("chat:a", async () => {
      order.push(1);
      await Bun.sleep(30);
      order.push(2);
    });
    const second = lock.withLock("chat:a", async () => {
      order.push(3);
    });

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
  });

  test("rejected predecessor does not block or cause unhandledRejection", async () => {
    const lock = createChatLock();
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const stale = Promise.reject(new Error("stale predecessor"));
      stale.catch(() => undefined);
      lock.seedForTests("chat:reject", stale);

      let ran = false;
      await lock.withLock("chat:reject", async () => {
        ran = true;
      });
      await Bun.sleep(20);

      expect(ran).toBe(true);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("waitMs timeout proceeds concurrent with wedged predecessor", async () => {
    const lock = createChatLock({ waitMs: 25 });
    let releaseWedge!: () => void;
    const wedge = new Promise<void>((resolve) => {
      releaseWedge = resolve;
    });
    lock.seedForTests("chat:wedge", wedge);

    const started: number[] = [];
    const running = lock.withLock("chat:wedge", async () => {
      started.push(Date.now());
      await Bun.sleep(10);
    });

    const began = Date.now();
    await running;
    const waited = Date.now() - began;

    expect(started).toHaveLength(1);
    expect(waited).toBeGreaterThanOrEqual(20);
    releaseWedge();
  });
});
