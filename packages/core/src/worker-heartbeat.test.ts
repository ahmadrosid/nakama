import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkerHeartbeatStore,
  isHeartbeatAlive,
} from "./worker-heartbeat";

describe("worker-heartbeat store", () => {
  test("isHeartbeatAlive rejects stale heartbeats", () => {
    expect(
      isHeartbeatAlive({
        pid: process.pid,
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      })
    ).toBe(false);
  });

  test("write/read/clear round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nakama-worker-heartbeat-"));
    const store = createWorkerHeartbeatStore({ getDir: () => dir });

    try {
      await store.write({
        pid: 42,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(await store.read()).toEqual({
        pid: 42,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      await store.clear();
      expect(await store.read()).toBeNull();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
