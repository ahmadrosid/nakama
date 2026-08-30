import { afterEach, describe, expect, test } from "bun:test";
import {
  resetChatLocksForTests,
  seedChatLockForTests,
  withChatLock,
} from "./chat-handler";

afterEach(() => {
  resetChatLocksForTests();
});

describe("withChatLock rejection safety", () => {
  test("rejected predecessor does not cause unhandledRejection", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const stale = Promise.reject(new Error("stale predecessor"));
      // Absorb the seed rejection; the bug is a *second* rejected chain promise.
      stale.catch(() => undefined);
      seedChatLockForTests("jid:reject", stale);

      let ran = false;
      await withChatLock("jid:reject", async () => {
        ran = true;
      });
      await Bun.sleep(20);

      expect(ran).toBe(true);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
