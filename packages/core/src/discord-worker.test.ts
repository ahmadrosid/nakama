import { describe, expect, test } from "bun:test";
import {
  isHeartbeatAlive,
  isProcessAlive,
  parseDiscordWorkerHeartbeat,
  resolveDiscordWorkerStatus,
} from "./discord-worker";

describe("resolveDiscordWorkerStatus", () => {
  test("is ok when discord is not configured", () => {
    expect(
      resolveDiscordWorkerStatus(
        {
          configured: false,
          botTokenMasked: null,
          handshakeCode: null,
          pairedUserIds: [],
          allowedUserIds: [],
          profileId: "default",
        },
        false,
      ),
    ).toEqual({
      ok: true,
      configured: false,
      paired: false,
      running: false,
      connected: false,
    });
  });

  test("requires a running worker when configured", () => {
    expect(
      resolveDiscordWorkerStatus(
        {
          configured: true,
          botTokenMasked: "••••1234",
          handshakeCode: "ABCD",
          pairedUserIds: [],
          allowedUserIds: [],
          profileId: "default",
        },
        false,
      ),
    ).toEqual({
      ok: false,
      configured: true,
      paired: false,
      running: false,
      connected: false,
    });

    expect(
      resolveDiscordWorkerStatus(
        {
          configured: true,
          botTokenMasked: "••••1234",
          handshakeCode: null,
          pairedUserIds: ["123456789012345678"],
          allowedUserIds: [],
          profileId: "default",
        },
        true,
        true,
      ),
    ).toEqual({
      ok: true,
      configured: true,
      paired: true,
      running: true,
      connected: true,
    });
  });
});

describe("parseDiscordWorkerHeartbeat", () => {
  test("parses valid JSON with connected flag", () => {
    expect(
      parseDiscordWorkerHeartbeat(
        JSON.stringify({ pid: 12, updatedAt: "2026-01-01T00:00:00.000Z", connected: true }),
      ),
    ).toEqual({ pid: 12, updatedAt: "2026-01-01T00:00:00.000Z", connected: true });
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
      }),
    ).toBe(true);
  });
});

describe("isProcessAlive", () => {
  test("returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
});
