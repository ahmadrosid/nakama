import { describe, expect, test } from "bun:test";
import {
  parseTelegramWorkerHeartbeat,
  resolveTelegramWorkerStatus,
} from "./telegram-worker";

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

describe("parseTelegramWorkerHeartbeat", () => {
  test("parses valid JSON", () => {
    expect(
      parseTelegramWorkerHeartbeat(
        JSON.stringify({ pid: 12, updatedAt: "2026-01-01T00:00:00.000Z" })
      )
    ).toEqual({ pid: 12, updatedAt: "2026-01-01T00:00:00.000Z" });
  });

  test("returns null for invalid payloads", () => {
    expect(parseTelegramWorkerHeartbeat("not json")).toBeNull();
    expect(parseTelegramWorkerHeartbeat("{}")).toBeNull();
  });
});
