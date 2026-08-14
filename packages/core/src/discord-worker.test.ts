import { describe, expect, test } from "bun:test";
import {
  isHeartbeatAlive,
  parseDiscordWorkerHeartbeat,
  resolveDiscordWorkerStatus,
} from "./discord-worker";

describe("resolveDiscordWorkerStatus", () => {
  test("is ok when discord is not configured", () => {
    expect(
      resolveDiscordWorkerStatus(
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
      connected: false,
      ok: true,
      paired: false,
      running: false,
    });
  });

  test("requires a running worker when configured", () => {
    expect(
      resolveDiscordWorkerStatus(
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
      connected: false,
      ok: false,
      paired: false,
      running: false,
    });

    expect(
      resolveDiscordWorkerStatus(
        {
          allowedUserIds: [],
          botTokenMasked: "••••1234",
          configured: true,
          handshakeCode: null,
          pairedUserIds: ["123456789012345678"],
          profileId: "default",
        },
        true,
        true
      )
    ).toEqual({
      configured: true,
      connected: true,
      ok: true,
      paired: true,
      running: true,
    });
  });
});

describe("parseDiscordWorkerHeartbeat", () => {
  test("parses valid JSON with connected flag", () => {
    expect(
      parseDiscordWorkerHeartbeat(
        JSON.stringify({
          connected: true,
          pid: 12,
          updatedAt: "2026-01-01T00:00:00.000Z",
        })
      )
    ).toEqual({
      connected: true,
      pid: 12,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  test("returns null for invalid payloads", () => {
    expect(parseDiscordWorkerHeartbeat("not json")).toBeNull();
    expect(parseDiscordWorkerHeartbeat("{}")).toBeNull();
  });
});

describe("isHeartbeatAlive", () => {
  test("accepts a fresh heartbeat for the current process", () => {
    expect(
      isHeartbeatAlive({
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      })
    ).toBe(true);
  });
});
