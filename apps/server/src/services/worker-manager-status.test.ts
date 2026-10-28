import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkerDesiredState, setWorkerDesiredRunning } from "@nakama/core";
import { getChannelConfigDir } from "@nakama/core/channel-config-shared";
import { saveWhatsAppConfig } from "@nakama/core/whatsapp-config";
import { createWorkerHeartbeatStore } from "@nakama/core/worker-heartbeat";
import { WorkerManagerService } from "./worker-manager-service";

type Pm2Client = NonNullable<
  ConstructorParameters<typeof WorkerManagerService>[1]
>;

function createMockPm2() {
  const mockPm2 = {
    connect: mock((cb: (err: Error | null) => void) => cb(null)),
    delete: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    describe: mock((_name: string, cb: Parameters<Pm2Client["list"]>[0]) =>
      cb(null, [])
    ),
    disconnect: mock(() => {}),
    flush: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    list: mock((cb: Parameters<Pm2Client["list"]>[0]) => cb(null, [])),
    restart: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    start: mock(
      (
        _opts: Parameters<Pm2Client["start"]>[0],
        cb: (err: Error | null) => void
      ) => cb(null)
    ),
    stop: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
  };

  return mockPm2;
}

const projectRoot = "/tmp/test-project";

let configDir: string | null = null;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "nakama-worker-manager-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
});

afterEach(async () => {
  if (configDir) {
    await rm(configDir, { force: true, recursive: true });
    configDir = null;
  }

  delete process.env.NAKAMA_CONFIG_DIR;
});

describe("WorkerManagerService", () => {
  describe("getAllWorkerStatuses", () => {
    test("returns managed true for stopped workers when PM2 is available", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: Parameters<Pm2Client["list"]>[0]) =>
        cb(null, [
          {
            monit: { cpu: 3.1, memory: 60_000_000 },
            name: "telegram",
            pm2_env: { pm_uptime: Date.now() - 120_000, status: "online" },
          },
        ])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const result = await service.getAllWorkerStatuses();

      expect(mockPm2.list).toHaveBeenCalledTimes(1);
      expect(result.telegram.managed).toBe(true);
      expect(result.telegram.status).toBe("online");
      expect(result.telegram.cpuPercent).toBe(3.1);
      expect(result.whatsapp.managed).toBe(true);
      expect(result.whatsapp.status).toBe("stopped");
    });

    test("returns managed true for profile-scoped statuses including slack", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: Parameters<Pm2Client["list"]>[0]) =>
        cb(null, [])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const result = await service.getAllWorkerStatuses({
        orgId: "org_a",
        profileId: "profile_a",
      });

      expect(result.telegram.managed).toBe(true);
      expect(result.slack.managed).toBe(true);
    });

    test("returns managed: false for all when PM2 connect fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.connect = mock((cb: (err: Error | null) => void) =>
        cb(new Error("connect failed"))
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const result = await service.getAllWorkerStatuses();

      expect(result.telegram.managed).toBe(false);
      expect(result.whatsapp.managed).toBe(false);
    });
  });

  describe("getWorkerLogs", () => {
    test("returns last N lines of stdout and stderr", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "nakama-logs-"));
      const outPath = join(tmpDir, "out.log");
      const errPath = join(tmpDir, "err.log");
      await writeFile(outPath, "line1\nline2\nline3\nline4\nline5\n");
      await writeFile(errPath, "err1\nerr2\nerr3\n");

      const mockPm2 = createMockPm2();
      mockPm2.describe = mock(
        (_name: string, cb: Parameters<Pm2Client["list"]>[0]) =>
          cb(null, [
            {
              name: "whatsapp",
              pm2_env: {
                pm_err_log_path: errPath,
                pm_out_log_path: outPath,
              },
            },
          ])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const logs = await service.getWorkerLogs("whatsapp", 2);

      expect(logs.stdout).toBe("line4\nline5");
      expect(logs.stderr).toBe("err2\nerr3");

      await unlink(outPath);
      await unlink(errPath);
    });

    test("returns empty strings when log files are missing", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.describe = mock(
        (_name: string, cb: Parameters<Pm2Client["list"]>[0]) =>
          cb(null, [
            {
              name: "whatsapp",
              pm2_env: {
                pm_err_log_path: "/nonexistent/err.log",
                pm_out_log_path: "/nonexistent/out.log",
              },
            },
          ])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const logs = await service.getWorkerLogs("whatsapp", 10);

      expect(logs.stdout).toBe("");
      expect(logs.stderr).toBe("");
    });

    test("returns empty strings when pm2_env has no log paths", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.describe = mock(
        (_name: string, cb: Parameters<Pm2Client["list"]>[0]) =>
          cb(null, [
            {
              name: "whatsapp",
              pm2_env: {},
            },
          ])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const logs = await service.getWorkerLogs("whatsapp", 10);

      expect(logs.stdout).toBe("");
      expect(logs.stderr).toBe("");
    });

    test("throws when PM2 describe fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.describe = mock(
        (_name: string, cb: Parameters<Pm2Client["list"]>[0]) =>
          cb(new Error("PM2 describe failed"))
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      expect(service.getWorkerLogs("whatsapp", 10)).rejects.toThrow(
        "PM2 describe failed"
      );
    });
  });

  describe("recoverDesiredWorkers", () => {
    test("does not recover unowned legacy channel workers", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: Parameters<Pm2Client["list"]>[0]) =>
        cb(null, [])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await setWorkerDesiredRunning("automation", false);
      await setWorkerDesiredRunning("telegram", true);
      await service.recoverDesiredWorkers();

      expect(mockPm2.start).not.toHaveBeenCalled();
    });

    test("recovers automation worker when desired", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: Parameters<Pm2Client["list"]>[0]) =>
        cb(null, [])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await setWorkerDesiredRunning("automation", true);
      await service.recoverDesiredWorkers();

      // SAFETY: The test fixture matches the contract used by this test.
      const calls = (mockPm2.start as ReturnType<typeof mock>).mock.calls;
      const opts = calls[0]?.[0];
      expect(opts?.name).toBe("automation");
    });

    test("skips workers that are already online", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: Parameters<Pm2Client["list"]>[0]) =>
        cb(null, [
          {
            monit: { cpu: 1, memory: 1_000_000 },
            name: "telegram",
            pm2_env: { pm_uptime: Date.now(), status: "online" },
          },
        ])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await setWorkerDesiredRunning("automation", false);
      await setWorkerDesiredRunning("telegram", true);
      await service.recoverDesiredWorkers();

      expect(mockPm2.start).not.toHaveBeenCalled();
    });

    test("recovery does not start over a live manual owner", async () => {
      const owner = { orgId: "org_a", profileId: "agent_a" };
      await saveWhatsAppConfig({}, owner);
      await setWorkerDesiredRunning("automation", false);
      await setWorkerDesiredRunning("whatsapp", true, owner);

      const manualWorker = createWorkerHeartbeatStore({
        getDir: () => getChannelConfigDir("whatsapp", owner),
      });

      await manualWorker.acquire();
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      try {
        await service.recoverDesiredWorkers();
      } finally {
        await manualWorker.clear();
      }

      expect((await readWorkerDesiredState(owner)).whatsapp).toBe(true);
      expect(mockPm2.start).not.toHaveBeenCalled();
    });
  });

  describe("clearWorkerLogs", () => {
    test("flushes logs for a valid worker", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.clearWorkerLogs("whatsapp");

      expect(mockPm2.flush).toHaveBeenCalledWith(
        "whatsapp",
        expect.any(Function)
      );
    });

    test("throws when PM2 flush fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.flush = mock((_name: string, cb: (err: Error | null) => void) =>
        cb(new Error("PM2 flush failed"))
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      expect(service.clearWorkerLogs("whatsapp")).rejects.toThrow(
        "PM2 flush failed"
      );
    });
  });
});
