import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, unlink, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkerManagerService } from "./worker-manager-service";
import { readWorkerDesiredState, setWorkerDesiredRunning } from "@nakama/core";

function createMockPm2() {
  const mockPm2 = {
    connect: mock((cb: (err: Error | null) => void) => cb(null)),
    disconnect: mock(() => {}),
    delete: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    start: mock((_opts: unknown, cb: (err: Error | null) => void) => cb(null)),
    stop: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    restart: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    list: mock((cb: (err: Error | null, list: unknown[]) => void) => cb(null, [])),
    describe: mock((_name: string, cb: (err: Error | null, list: unknown[]) => void) => cb(null, [])),
    flush: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
  };

  return mockPm2 as unknown as typeof import("pm2");
}

const projectRoot = "/tmp/test-project";
let configDir: string | null = null;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "nakama-worker-manager-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
});

afterEach(async () => {
  if (configDir) {
    await rm(configDir, { recursive: true, force: true });
    configDir = null;
  }

  delete process.env.NAKAMA_CONFIG_DIR;
});

describe("WorkerManagerService", () => {
  describe("isValidWorker", () => {
    test("returns true for telegram", () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.isValidWorker("telegram")).toBe(true);
    });

    test("returns true for whatsapp", () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.isValidWorker("whatsapp")).toBe(true);
    });

    test("returns true for automation", () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.isValidWorker("automation")).toBe(true);
    });

    test("returns true for discord", () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.isValidWorker("discord")).toBe(true);
    });

    test("returns false for unknown worker", () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.isValidWorker("foobar")).toBe(false);
    });
  });

  describe("startWorker", () => {
    test("starts telegram worker with correct script path", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.startWorker("telegram");

      expect(mockPm2.stop).toHaveBeenCalledWith("telegram", expect.any(Function));
      expect(mockPm2.delete).toHaveBeenCalledWith("telegram", expect.any(Function));
      expect(mockPm2.start).toHaveBeenCalledTimes(1);
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.script).toBe("bun");
      expect(opts.args).toContain("apps/platform/telegram/src/index.ts");
      expect(opts.interpreter).toBeUndefined();
      expect(opts.name).toBe("telegram");
      expect(await readWorkerDesiredState()).toEqual({ telegram: true, whatsapp: false, discord: false, automation: true });
    });

    test("starts whatsapp worker", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.startWorker("whatsapp");

      expect(mockPm2.start).toHaveBeenCalledTimes(1);
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.name).toBe("whatsapp");
      expect(opts.script).toBe("bun");
      expect(opts.args).toContain("apps/platform/whatsapp/src/index.ts");
      expect(opts.interpreter).toBeUndefined();
    });

    test("starts automation worker", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.startWorker("automation");

      expect(mockPm2.start).toHaveBeenCalledTimes(1);
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.name).toBe("automation");
      expect(opts.script).toBe("bun");
      expect(opts.args).toContain("apps/platform/automation/src/index.ts");
      expect(opts.interpreter).toBeUndefined();
      expect(await readWorkerDesiredState()).toEqual({ telegram: false, whatsapp: false, discord: false, automation: true });
    });

    test("starts worker from dist when dist build exists", async () => {
      const tmpProjectRoot = await mkdtemp(join(tmpdir(), "nakama-worker-dist-"));
      const distFilePath = join(tmpProjectRoot, "apps/platform/whatsapp/dist/index.js");
      await mkdir(join(tmpProjectRoot, "apps/platform/whatsapp/dist"), { recursive: true });
      await writeFile(distFilePath, "console.log('ok')");

      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(tmpProjectRoot, mockPm2);

      await service.startWorker("whatsapp");

      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.args).toContain("apps/platform/whatsapp/dist/index.js");

      await rm(tmpProjectRoot, { recursive: true, force: true });
    });

    test("starts telegram worker from dist when dist build exists", async () => {
      const tmpProjectRoot = await mkdtemp(join(tmpdir(), "nakama-worker-dist-"));
      const distFilePath = join(tmpProjectRoot, "apps/platform/telegram/dist/index.js");
      await mkdir(join(tmpProjectRoot, "apps/platform/telegram/dist"), { recursive: true });
      await writeFile(distFilePath, "console.log('ok')");

      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(tmpProjectRoot, mockPm2);

      await service.startWorker("telegram");

      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.args).toContain("apps/platform/telegram/dist/index.js");

      await rm(tmpProjectRoot, { recursive: true, force: true });
    });

    test("starts automation worker from dist when dist build exists", async () => {
      const tmpProjectRoot = await mkdtemp(join(tmpdir(), "nakama-worker-dist-"));
      const distFilePath = join(tmpProjectRoot, "apps/platform/automation/dist/index.js");
      await mkdir(join(tmpProjectRoot, "apps/platform/automation/dist"), { recursive: true });
      await writeFile(distFilePath, "console.log('ok')");

      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(tmpProjectRoot, mockPm2);

      await service.startWorker("automation");

      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.args).toContain("apps/platform/automation/dist/index.js");

      await rm(tmpProjectRoot, { recursive: true, force: true });
    });

    test("throws for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.startWorker("foobar")).rejects.toThrow("Unknown worker");
    });

    test("throws when PM2 start fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.start = mock((_opts: unknown, cb: (err: Error | null) => void) =>
        cb(new Error("PM2 start failed")),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      expect(service.startWorker("telegram")).rejects.toThrow("PM2 start failed");
    });
  });

  describe("stopWorker", () => {
    test("stops worker by name", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.stopWorker("telegram");

      expect(mockPm2.stop).toHaveBeenCalledWith("telegram", expect.any(Function));
      expect(await readWorkerDesiredState()).toEqual({ telegram: false, whatsapp: false, discord: false, automation: true });
    });

    test("throws for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.stopWorker("foobar")).rejects.toThrow("Unknown worker");
    });
  });

  describe("restartWorker", () => {
    test("restarts worker by removing from pm2 and starting fresh", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.restartWorker("telegram");

      expect(mockPm2.stop).toHaveBeenCalledWith("telegram", expect.any(Function));
      expect(mockPm2.delete).toHaveBeenCalledWith("telegram", expect.any(Function));
      expect(mockPm2.restart).not.toHaveBeenCalled();
      expect(mockPm2.start).toHaveBeenCalledTimes(1);
    });

    test("throws for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.restartWorker("foobar")).rejects.toThrow("Unknown worker");
    });
  });

  describe("getWorkerStatus", () => {
    test("returns managed status for running worker", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, [
          {
            name: "telegram",
            pid: 1234,
            pm2_env: { status: "online", pm_uptime: Date.now() - 60000 },
            monit: { cpu: 2.5, memory: 45_000_000 },
          },
        ]),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const status = await service.getWorkerStatus("telegram");

      expect(status).toEqual({
        managed: true,
        status: "online",
        cpuPercent: 2.5,
        memoryMb: 42.92,
        uptimeSeconds: expect.any(Number),
      });
    });

    test("returns managed: true / stopped when worker not in PM2 list", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, []),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const status = await service.getWorkerStatus("telegram");

      expect(status).toEqual({
        managed: true,
        status: "stopped",
        cpuPercent: null,
        memoryMb: null,
        uptimeSeconds: null,
      });
    });

    test("returns managed: false when PM2 connect fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.connect = mock((cb: (err: Error | null) => void) =>
        cb(new Error("PM2 daemon not running")),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const status = await service.getWorkerStatus("telegram");

      expect(status).toEqual({
        managed: false,
        status: null,
        cpuPercent: null,
        memoryMb: null,
        uptimeSeconds: null,
      });
    });

    test("returns null for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      const status = await service.getWorkerStatus("foobar");
      expect(status).toBeNull();
    });
  });

  describe("getAllWorkerStatuses", () => {
    test("returns managed true for stopped workers when PM2 is available", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, [
          {
            name: "telegram",
            pm2_env: { status: "online", pm_uptime: Date.now() - 120000 },
            monit: { cpu: 3.1, memory: 60_000_000 },
          },
        ]),
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

    test("returns managed: false for all when PM2 connect fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.connect = mock((cb: (err: Error | null) => void) =>
        cb(new Error("connect failed")),
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
      mockPm2.describe = mock((_name: string, cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, [
          {
            name: "whatsapp",
            pm2_env: {
              pm_out_log_path: outPath,
              pm_err_log_path: errPath,
            },
          },
        ]),
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
      mockPm2.describe = mock((_name: string, cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, [
          {
            name: "whatsapp",
            pm2_env: {
              pm_out_log_path: "/nonexistent/out.log",
              pm_err_log_path: "/nonexistent/err.log",
            },
          },
        ]),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const logs = await service.getWorkerLogs("whatsapp", 10);

      expect(logs.stdout).toBe("");
      expect(logs.stderr).toBe("");
    });

    test("returns empty strings when pm2_env has no log paths", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.describe = mock((_name: string, cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, [
          {
            name: "whatsapp",
            pm2_env: {},
          },
        ]),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const logs = await service.getWorkerLogs("whatsapp", 10);

      expect(logs.stdout).toBe("");
      expect(logs.stderr).toBe("");
    });

    test("throws for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.getWorkerLogs("foobar", 10)).rejects.toThrow("Unknown worker");
    });

    test("throws when PM2 describe fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.describe = mock((_name: string, cb: (err: Error | null, list: unknown[]) => void) =>
        cb(new Error("PM2 describe failed")),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      expect(service.getWorkerLogs("whatsapp", 10)).rejects.toThrow("PM2 describe failed");
    });
  });

  describe("recoverDesiredWorkers", () => {
    test("starts workers marked as desired when they are not online", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, []),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await setWorkerDesiredRunning("automation", false);
      await setWorkerDesiredRunning("telegram", true);
      await service.recoverDesiredWorkers();

      expect(mockPm2.start).toHaveBeenCalledTimes(1);
    });

    test("recovers automation worker when desired", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, []),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await setWorkerDesiredRunning("automation", true);
      await service.recoverDesiredWorkers();

      const calls = (mockPm2.start as ReturnType<typeof mock>).mock.calls;
      const opts = calls[0]?.[0];
      expect(opts?.name).toBe("automation");
    });

    test("skips workers that are already online", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, [
          {
            name: "telegram",
            pm2_env: { status: "online", pm_uptime: Date.now() },
            monit: { cpu: 1, memory: 1_000_000 },
          },
        ]),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await setWorkerDesiredRunning("automation", false);
      await setWorkerDesiredRunning("telegram", true);
      await service.recoverDesiredWorkers();

      expect(mockPm2.start).not.toHaveBeenCalled();
    });
  });

  describe("clearWorkerLogs", () => {
    test("flushes logs for a valid worker", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.clearWorkerLogs("whatsapp");

      expect(mockPm2.flush).toHaveBeenCalledWith("whatsapp", expect.any(Function));
    });

    test("throws for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.clearWorkerLogs("foobar")).rejects.toThrow("Unknown worker");
    });

    test("throws when PM2 flush fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.flush = mock((_name: string, cb: (err: Error | null) => void) =>
        cb(new Error("PM2 flush failed")),
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      expect(service.clearWorkerLogs("whatsapp")).rejects.toThrow("PM2 flush failed");
    });
  });
});
