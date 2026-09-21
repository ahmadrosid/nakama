import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkerHeartbeatStore,
  isHeartbeatAlive,
} from "./worker-heartbeat";

describe("worker-heartbeat store", () => {
  test("only one worker acquires a connection and release permits a replacement", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nakama-worker-lock-"));
    const first = createWorkerHeartbeatStore({ getDir: () => dir });
    const second = createWorkerHeartbeatStore({ getDir: () => dir });
    try {
      await first.acquire();
      await expect(second.acquire()).rejects.toThrow();
      await first.clear();
      await second.acquire();
      await second.write({
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      });
      await first.clear();
      expect(await second.read()).not.toBeNull();
    } finally {
      await second.clear();
      await rm(dir, { force: true, recursive: true });
    }
  });
  test("isHeartbeatAlive rejects stale, missing, and invalid heartbeats", () => {
    expect(isHeartbeatAlive(null)).toBe(false);
    expect(
      isHeartbeatAlive({
        pid: process.pid,
        updatedAt: "not-a-date",
      })
    ).toBe(false);
    expect(
      isHeartbeatAlive({
        pid: process.pid,
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      })
    ).toBe(false);
    expect(
      isHeartbeatAlive({
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      })
    ).toBe(true);
  });

  test("write/read/clear round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nakama-worker-heartbeat-"));
    const store = createWorkerHeartbeatStore({ getDir: () => dir });

    try {
      await store.write({
        pid: process.pid,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(await store.read()).toEqual({
        pid: process.pid,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      await store.clear();
      expect(await store.read()).toBeNull();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

test("a killed worker releases its operating-system connection lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nakama-worker-crash-"));
  const modulePath = new URL("./worker-heartbeat.ts", import.meta.url).pathname;
  const script = `import {createWorkerHeartbeatStore} from ${JSON.stringify(modulePath)}; const store = createWorkerHeartbeatStore({getDir: () => process.argv[1]}); await store.acquire(); console.log("ready"); setInterval(() => {}, 1000);`;
  const child = Bun.spawn([process.execPath, "-e", script, dir], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const replacement = createWorkerHeartbeatStore({ getDir: () => dir });
  try {
    const reader = child.stdout.getReader();
    const ready = await reader.read();
    expect(new TextDecoder().decode(ready.value)).toContain("ready");
    reader.releaseLock();
    await expect(replacement.acquire()).rejects.toThrow();
    child.kill("SIGKILL");
    await child.exited;
    await replacement.acquire();
    await replacement.write({
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    });
    expect((await replacement.read())?.pid).toBe(process.pid);
  } finally {
    child.kill();
    await child.exited;
    await replacement.clear();
    await rm(dir, { force: true, recursive: true });
  }
});
