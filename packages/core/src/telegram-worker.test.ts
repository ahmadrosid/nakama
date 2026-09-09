import { describe, expect, test } from "bun:test";
import {
  createTelegramWorkerHeartbeat,
  resolveTelegramWorkerStatus,
} from "./telegram-worker";
import { withTempHomedir } from "./testing/channel-config-fixtures";

describe("resolveTelegramWorkerStatus", () => {
  test("is ok when telegram is not configured", () => {
    expect(
      resolveTelegramWorkerStatus(
        {
          allowedUserIds: [],
          botTokenMasked: null,
          configured: false,
          handshakeCode: null,
          pairedUserIds: [],
          profileId: "default",
        },
        false
      )
    ).toEqual({
      configured: false,
      ok: true,
      paired: false,
      running: false,
    });
  });

  test("requires a running worker when configured", () => {
    expect(
      resolveTelegramWorkerStatus(
        {
          allowedUserIds: [],
          botTokenMasked: "••••1234",
          configured: true,
          handshakeCode: "ABCD",
          pairedUserIds: [],
          profileId: "default",
        },
        false
      )
    ).toEqual({
      configured: true,
      ok: false,
      paired: false,
      running: false,
    });

    expect(
      resolveTelegramWorkerStatus(
        {
          allowedUserIds: [],
          botTokenMasked: "••••1234",
          configured: true,
          handshakeCode: null,
          pairedUserIds: [42],
          profileId: "default",
        },
        true
      )
    ).toEqual({
      configured: true,
      ok: true,
      paired: true,
      running: true,
    });
  });
});

describe("createTelegramWorkerHeartbeat", () => {
  test("claims each identity separately", async () => {
    await withTempHomedir("nakama-telegram-hb-", async () => {
      const legacy = createTelegramWorkerHeartbeat(null);
      const orgA = createTelegramWorkerHeartbeat("org_a");

      await legacy.write({
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      });

      expect(await legacy.isRunning()).toBe(true);
      expect(await orgA.isRunning()).toBe(false);
    });
  });
});
