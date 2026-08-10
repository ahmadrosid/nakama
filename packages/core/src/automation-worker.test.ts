import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearAutomationWorkerHeartbeat,
  getAutomationWorkerHeartbeatStatus,
  isAutomationHeartbeatAlive,
  isAutomationWorkerRunning,
  parseAutomationWorkerHeartbeat,
  readAutomationWorkerHeartbeat,
  writeAutomationWorkerHeartbeat,
} from "./automation-worker";

let configDir: string | null = null;

async function useTempConfigDir(): Promise<string> {
  configDir = await mkdtemp(join(tmpdir(), "nakama-automation-worker-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  return configDir;
}

async function cleanupTempConfigDir(): Promise<void> {
  if (configDir) {
    await rm(configDir, { force: true, recursive: true });
    configDir = null;
  }
  delete process.env.NAKAMA_CONFIG_DIR;
}

describe("automation-worker heartbeat", () => {
  test("write and read heartbeat", async () => {
    await useTempConfigDir();

    try {
      await writeAutomationWorkerHeartbeat(
        true,
        3,
        1234,
        "2026-06-25T10:00:00.000Z"
      );
      const heartbeat = await readAutomationWorkerHeartbeat();

      expect(heartbeat).toEqual({
        pid: 1234,
        running: true,
        scheduledJobs: 3,
        updatedAt: "2026-06-25T10:00:00.000Z",
      });
    } finally {
      await cleanupTempConfigDir();
    }
  });

  test("missing heartbeat returns null", async () => {
    await useTempConfigDir();

    try {
      expect(await readAutomationWorkerHeartbeat()).toBeNull();
    } finally {
      await cleanupTempConfigDir();
    }
  });

  test("stale heartbeat is not alive", () => {
    const heartbeat = {
      pid: process.pid,
      running: true,
      scheduledJobs: 1,
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    };

    expect(isAutomationHeartbeatAlive(heartbeat, 45_000)).toBe(false);
  });

  test("fresh heartbeat with current pid is alive", () => {
    const heartbeat = {
      pid: process.pid,
      running: true,
      scheduledJobs: 1,
      updatedAt: new Date().toISOString(),
    };

    expect(isAutomationHeartbeatAlive(heartbeat)).toBe(true);
  });

  test("heartbeat with running=false is not alive", () => {
    const heartbeat = {
      pid: process.pid,
      running: false,
      scheduledJobs: 0,
      updatedAt: new Date().toISOString(),
    };

    expect(isAutomationHeartbeatAlive(heartbeat)).toBe(false);
  });

  test("malformed heartbeat is parsed as null", () => {
    expect(parseAutomationWorkerHeartbeat("not json")).toBeNull();
    expect(parseAutomationWorkerHeartbeat('{"pid":123}')).toBeNull();
    expect(
      parseAutomationWorkerHeartbeat(
        '{"pid":"123","updatedAt":"x","running":true,"scheduledJobs":1}'
      )
    ).toBeNull();
  });

  test("clear heartbeat removes the file", async () => {
    await useTempConfigDir();

    try {
      await writeAutomationWorkerHeartbeat(true, 1);
      expect(await readAutomationWorkerHeartbeat()).not.toBeNull();

      await clearAutomationWorkerHeartbeat();
      expect(await readAutomationWorkerHeartbeat()).toBeNull();
    } finally {
      await cleanupTempConfigDir();
    }
  });

  test("status reflects heartbeat freshness", async () => {
    await useTempConfigDir();

    try {
      await writeAutomationWorkerHeartbeat(true, 5);
      const status = await getAutomationWorkerHeartbeatStatus();

      expect(status.running).toBe(true);
      expect(status.scheduledJobs).toBe(5);
      expect(status.pid).toBe(process.pid);
    } finally {
      await cleanupTempConfigDir();
    }
  });

  test("running returns false when heartbeat is missing", async () => {
    await useTempConfigDir();

    try {
      expect(await isAutomationWorkerRunning()).toBe(false);
    } finally {
      await cleanupTempConfigDir();
    }
  });
});
