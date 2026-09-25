import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkerDesiredState, setWorkerDesiredRunning } from "@nakama/core";
import {
  claimChannelIdentity,
  getChannelConfigDir,
} from "@nakama/core/channel-config-shared";
import { saveWhatsAppConfig } from "@nakama/core/whatsapp-config";
import { WorkerManagerService } from "./worker-manager-service";

function createMockPm2() {
  const mockPm2 = {
    connect: mock((cb: (err: Error | null) => void) => cb(null)),
    delete: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    describe: mock(
      (_name: string, cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, [])
    ),
    disconnect: mock(() => {}),
    flush: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    list: mock((cb: (err: Error | null, list: unknown[]) => void) =>
      cb(null, [])
    ),
    restart: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    start: mock((_opts: unknown, cb: (err: Error | null) => void) => cb(null)),
    stop: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
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
    await rm(configDir, { force: true, recursive: true });
    configDir = null;
  }

  delete process.env.NAKAMA_CONFIG_DIR;
});

describe("WorkerManagerService", () => {
  test("isolates agent processes, desired state, and recovery", async () => {
    const first = { orgId: "org_a", profileId: "agent_a" };
    const second = { orgId: "org_a", profileId: "agent_b" };
    await saveWhatsAppConfig({}, first);
    await saveWhatsAppConfig({}, second);
    await setWorkerDesiredRunning("automation", false);
    const pm2 = createMockPm2();
    const service = new WorkerManagerService(projectRoot, pm2);
    await service.startWorker("whatsapp", first);
    await service.startWorker("whatsapp", second);
    const calls = (pm2.start as ReturnType<typeof mock>).mock.calls;
    expect(calls[0][0].name).not.toBe(calls[1][0].name);
    expect(calls[0][0].env.NAKAMA_CHANNEL_PROFILE_ID).toBe(first.profileId);
    await service.stopWorker("whatsapp", first);
    expect((await readWorkerDesiredState(first)).whatsapp).toBe(false);
    expect((await readWorkerDesiredState(second)).whatsapp).toBe(true);
    (pm2.start as ReturnType<typeof mock>).mockClear();
    await service.recoverDesiredWorkers();
    expect(pm2.start).toHaveBeenCalledTimes(1);
    expect(
      (pm2.start as ReturnType<typeof mock>).mock.calls[0][0].env
        .NAKAMA_CHANNEL_PROFILE_ID
    ).toBe(second.profileId);
  });

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
    test("uses separate processes and desired state per WhatsApp organization", async () => {
      const pm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, pm2);
      await service.startWorker("whatsapp", "org_a");
      await service.startWorker("whatsapp", "org_b");
      const calls = (pm2.start as ReturnType<typeof mock>).mock.calls;
      expect(calls[0][0].name).not.toBe(calls[1][0].name);
      expect(calls[0][0].env.NAKAMA_WHATSAPP_ORG_ID).toBe("org_a");
      expect(calls[1][0].env.NAKAMA_WHATSAPP_ORG_ID).toBe("org_b");
      (pm2.list as ReturnType<typeof mock>).mockImplementation((cb) =>
        cb(null, [
          { name: calls[0][0].name, pid: 101, pm2_env: { status: "online" } },
          { name: calls[1][0].name, pid: 202, pm2_env: { status: "stopped" } },
        ])
      );
      expect(
        (await service.getAllWorkerStatuses("org_a")).whatsapp.status
      ).toBe("online");
      expect(
        (await service.getAllWorkerStatuses("org_b")).whatsapp.status
      ).toBe("stopped");
      expect((await service.getAllWorkerStatuses()).whatsapp.status).not.toBe(
        "online"
      );
      await service.getWorkerLogs("whatsapp", 10, "org_b");
      expect(pm2.describe).toHaveBeenLastCalledWith(
        calls[1][0].name,
        expect.any(Function)
      );
      await service.stopWorker("whatsapp", "org_a");
      expect((await readWorkerDesiredState("org_a")).whatsapp).toBe(false);
      expect((await readWorkerDesiredState("org_b")).whatsapp).toBe(true);
      expect((await readWorkerDesiredState()).whatsapp).toBe(false);
      expect(pm2.stop).toHaveBeenLastCalledWith(
        calls[0][0].name,
        expect.any(Function)
      );
    });

    test("starts telegram worker with correct script path", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.startWorker("telegram");

      expect(mockPm2.stop).toHaveBeenCalledWith(
        "telegram",
        expect.any(Function)
      );
      expect(mockPm2.delete).toHaveBeenCalledWith(
        "telegram",
        expect.any(Function)
      );
      expect(mockPm2.start).toHaveBeenCalledTimes(1);
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.script).toBe("bun");
      expect(opts.args).toContain("apps/platform/telegram/src/index.ts");
      expect(opts.interpreter).toBeUndefined();
      expect(opts.name).toBe("telegram");
      expect(await readWorkerDesiredState()).toEqual({
        automation: true,
        discord: false,
        slack: false,
        telegram: true,
        whatsapp: false,
      });
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

    test("rejects an unscoped whatsapp worker when org accounts exist", async () => {
      await saveWhatsAppConfig({ profileId: "well-test" }, "org_a");
      await saveWhatsAppConfig({ profileId: "finance" }, "org_b");
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await expect(service.startWorker("whatsapp")).rejects.toThrow(
        "organization scope"
      );
      expect(mockPm2.start).not.toHaveBeenCalled();
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
      expect(await readWorkerDesiredState()).toEqual({
        automation: true,
        discord: false,
        slack: false,
        telegram: false,
        whatsapp: false,
      });
    });

    test("starts worker from dist when dist build exists", async () => {
      const tmpProjectRoot = await mkdtemp(
        join(tmpdir(), "nakama-worker-dist-")
      );
      const distFilePath = join(
        tmpProjectRoot,
        "apps/platform/whatsapp/dist/index.js"
      );
      await mkdir(join(tmpProjectRoot, "apps/platform/whatsapp/dist"), {
        recursive: true,
      });
      await writeFile(distFilePath, "console.log('ok')");

      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(tmpProjectRoot, mockPm2);

      await service.startWorker("whatsapp");

      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.args).toContain("apps/platform/whatsapp/dist/index.js");

      await rm(tmpProjectRoot, { force: true, recursive: true });
    });

    test("starts telegram worker from dist when dist build exists", async () => {
      const tmpProjectRoot = await mkdtemp(
        join(tmpdir(), "nakama-worker-dist-")
      );
      const distFilePath = join(
        tmpProjectRoot,
        "apps/platform/telegram/dist/index.js"
      );
      await mkdir(join(tmpProjectRoot, "apps/platform/telegram/dist"), {
        recursive: true,
      });
      await writeFile(distFilePath, "console.log('ok')");

      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(tmpProjectRoot, mockPm2);

      await service.startWorker("telegram");

      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.args).toContain("apps/platform/telegram/dist/index.js");

      await rm(tmpProjectRoot, { force: true, recursive: true });
    });

    test("starts automation worker from dist when dist build exists", async () => {
      const tmpProjectRoot = await mkdtemp(
        join(tmpdir(), "nakama-worker-dist-")
      );
      const distFilePath = join(
        tmpProjectRoot,
        "apps/platform/automation/dist/index.js"
      );
      await mkdir(join(tmpProjectRoot, "apps/platform/automation/dist"), {
        recursive: true,
      });
      await writeFile(distFilePath, "console.log('ok')");

      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(tmpProjectRoot, mockPm2);

      await service.startWorker("automation");

      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.args).toContain("apps/platform/automation/dist/index.js");

      await rm(tmpProjectRoot, { force: true, recursive: true });
    });

    test("throws for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.startWorker("foobar")).rejects.toThrow("Unknown worker");
    });

    test("throws when PM2 start fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.start = mock((_opts: unknown, cb: (err: Error | null) => void) =>
        cb(new Error("PM2 start failed"))
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      expect(service.startWorker("telegram")).rejects.toThrow(
        "PM2 start failed"
      );
    });
  });

  describe("stopWorker", () => {
    test("stops worker by name", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.stopWorker("telegram");

      expect(mockPm2.stop).toHaveBeenCalledWith(
        "telegram",
        expect.any(Function)
      );
      expect(await readWorkerDesiredState()).toEqual({
        automation: true,
        discord: false,
        slack: false,
        telegram: false,
        whatsapp: false,
      });
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

      expect(mockPm2.stop).toHaveBeenCalledWith(
        "telegram",
        expect.any(Function)
      );
      expect(mockPm2.delete).toHaveBeenCalledWith(
        "telegram",
        expect.any(Function)
      );
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
            monit: { cpu: 2.5, memory: 45_000_000 },
            name: "telegram",
            pid: 1234,
            pm2_env: { pm_uptime: Date.now() - 60_000, status: "online" },
          },
        ])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const status = await service.getWorkerStatus("telegram");

      expect(status).toEqual({
        cpuPercent: 2.5,
        managed: true,
        memoryMb: 42.92,
        status: "online",
        uptimeSeconds: expect.any(Number),
      });
    });

    test("returns managed: true / stopped when worker not in PM2 list", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, [])
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const status = await service.getWorkerStatus("telegram");

      expect(status).toEqual({
        cpuPercent: null,
        managed: true,
        memoryMb: null,
        status: "stopped",
        uptimeSeconds: null,
      });
    });

    test("returns managed: false when PM2 connect fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.connect = mock((cb: (err: Error | null) => void) =>
        cb(new Error("PM2 daemon not running"))
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      const status = await service.getWorkerStatus("telegram");

      expect(status).toEqual({
        cpuPercent: null,
        managed: false,
        memoryMb: null,
        status: null,
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
        (_name: string, cb: (err: Error | null, list: unknown[]) => void) =>
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
        (_name: string, cb: (err: Error | null, list: unknown[]) => void) =>
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
        (_name: string, cb: (err: Error | null, list: unknown[]) => void) =>
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

    test("throws for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.getWorkerLogs("foobar", 10)).rejects.toThrow(
        "Unknown worker"
      );
    });

    test("throws when PM2 describe fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.describe = mock(
        (_name: string, cb: (err: Error | null, list: unknown[]) => void) =>
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
      mockPm2.list = mock((cb: (err: Error | null, list: unknown[]) => void) =>
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
      mockPm2.list = mock((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(null, [])
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
      await writeFile(
        join(getChannelConfigDir("whatsapp", owner), "worker-heartbeat.json"),
        JSON.stringify({
          pid: process.pid,
          updatedAt: new Date().toISOString(),
        })
      );
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.recoverDesiredWorkers();

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

    test("throws for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.clearWorkerLogs("foobar")).rejects.toThrow(
        "Unknown worker"
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

test("plugin workers are isolated, recover desired state, and unregister without deleting data", async () => {
  const pm2 = createMockPm2();
  const service = new WorkerManagerService(projectRoot, pm2);
  const registration = {
    dataDir: join(configDir!, "notes-a"),
    orgId: "org-a",
    pluginId: "notes",
    releaseDir: configDir!,
    version: "1.0.0",
    workers: [{ entry: "worker.js", key: "indexer", name: "Notes indexer" }],
  };
  await writeFile(join(configDir!, "worker.js"), "");
  await service.registerPluginWorkers(registration, true);
  const [a] = await service.listPluginWorkers("org-a");
  expect(a!.name).toMatch(/^plugin-/);
  expect(service.isPluginWorkerForOrg(a!.name, "org-b")).toBe(false);
  await service.registerPluginWorkers(
    { ...registration, dataDir: join(configDir!, "notes-b"), orgId: "org-b" },
    true
  );
  const [b] = await service.listPluginWorkers("org-b");
  expect(a!.name).not.toBe(b!.name);
  pm2.list = mock((cb: (error: Error | null, list: unknown[]) => void) =>
    cb(null, [
      { name: a!.name, pm2_env: { status: "waiting restart" } },
      { name: b!.name, pm2_env: { status: "stopped" } },
    ])
  );
  const paused = await service.pausePluginWorkers();
  expect(paused).toEqual([a!.name]);
  expect(pm2.stop).toHaveBeenCalledWith(a!.name, expect.any(Function));
  await expect(service.startWorker(b!.name)).rejects.toThrow("disabled");
  await service.resumePluginWorkers(paused);
  await service.stopWorker(a!.name);
  const starts = (pm2.start as ReturnType<typeof mock>).mock.calls.length;
  await service.registerPluginWorkers(registration, false);
  expect((pm2.start as ReturnType<typeof mock>).mock.calls).toHaveLength(
    starts
  );
  await writeFile(join(registration.dataDir, "keep.txt"), "retained");
  await service.unregisterPluginWorkers("org-a", "notes");
  expect(service.isValidWorker(a!.name)).toBe(false);
  expect(await Bun.file(join(registration.dataDir, "keep.txt")).text()).toBe(
    "retained"
  );
  expect(service.isValidWorker(b!.name)).toBe(true);
});

test("Supermemory receives only the requested OpenAI configuration on each start", async () => {
  const llm = mock((type?: "openai") =>
    type === "openai"
      ? { apiKey: "test-key", model: "test-model", type: "openai" }
      : { apiKey: "restricted", type: "openai_compatible" }
  );
  const service = new WorkerManagerService(projectRoot, createMockPm2(), llm);
  await writeFile(join(configDir!, "worker.js"), "");
  const dataDir = join(configDir!, "supermemory");
  await service.registerPluginWorkers(
    {
      dataDir,
      orgId: "org",
      pluginId: "supermemory",
      releaseDir: configDir!,
      version: "0.1.0",
      workers: [{ entry: "worker.js", key: "server", name: "Supermemory" }],
    },
    true
  );
  expect(llm).toHaveBeenCalledWith("openai");
  expect(
    await Bun.file(join(dataDir, "workers/server/auto-provider.json")).json()
  ).toEqual({ apiKey: "test-key", model: "test-model", type: "openai" });
});

test("migration preserves an unambiguous connection and leaves ambiguous credentials stopped", async () => {
  const { createInMemoryDatabaseAdapter } = await import("@nakama/db");
  const { saveTelegramConfig, loadTelegramConfigFile } = await import(
    "@nakama/core/telegram-config"
  );
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();
  for (const id of ["org_a", "org_b"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      slug: id,
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: `agent_${id}`,
      isDefault: true,
      isSuper: false,
      model: "test",
      name: id,
      orgId: id,
      systemPrompt: "",
      updatedAt: now,
    });
  }
  await saveTelegramConfig(null, {
    botToken: "111:legacy",
    profileId: "default",
  });
  await saveWhatsAppConfig({ profileId: "agent_org_a" }, "org_a");
  await setWorkerDesiredRunning("whatsapp", true, "org_a");
  const pm2 = createMockPm2();
  const service = new WorkerManagerService(projectRoot, pm2);
  await service.migrateAgentChannels(db);
  expect(await service.legacyChannels("org_a", true)).toEqual([
    { global: true, platform: "telegram" },
  ]);
  const owner = { orgId: "org_a", profileId: "agent_org_a" };
  expect((await readWorkerDesiredState(owner)).whatsapp).toBe(true);
  expect(pm2.start).not.toHaveBeenCalled();
  await service.claimLegacyChannel("telegram", null, owner, db);
  expect((await loadTelegramConfigFile(owner))?.botToken).toBe("111:legacy");
  expect(await loadTelegramConfigFile(null)).toBeNull();
  await service.migrateAgentChannels(db);
  expect(await service.legacyChannels("org_a", true)).toEqual([]);
  await service.disconnectChannel("telegram", owner);
  expect(await loadTelegramConfigFile(owner)).toBeNull();
  await saveTelegramConfig(
    { orgId: "org_b", profileId: "agent_org_b" },
    { botToken: "111:rotated" }
  );
});

test("migration archives duplicate legacy WhatsApp credentials when the claimed agent is connected", async () => {
  const { createInMemoryDatabaseAdapter } = await import("@nakama/db");
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();
  for (const [orgId, profileId] of [
    ["org_a", "agent_a"],
    ["org_b", "agent_b"],
  ]) {
    await db.upsertOrganization({
      createdAt: now,
      id: orgId!,
      name: orgId!,
      slug: orgId!,
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: profileId!,
      isDefault: true,
      isSuper: false,
      model: "test",
      name: profileId!,
      orgId: orgId!,
      systemPrompt: "",
      updatedAt: now,
    });
  }
  const legacyDir = join(configDir!, "orgs", "org_a", "whatsapp");
  const active = { orgId: "org_b", profileId: "agent_b" };
  const activeDir = join(
    configDir!,
    "orgs",
    "org_b",
    "channels",
    "agent_b",
    "whatsapp"
  );
  await saveWhatsAppConfig({ profileId: "agent_a" }, "org_a");
  await saveWhatsAppConfig({}, active);
  await mkdir(join(legacyDir, "auth"), { recursive: true });
  await writeFile(
    join(legacyDir, "auth", "creds.json"),
    JSON.stringify({ me: { id: "123:4@s.whatsapp.net" } })
  );
  await claimChannelIdentity("whatsapp", active, "123@s.whatsapp.net");
  await setWorkerDesiredRunning("whatsapp", true, "org_a");

  const service = new WorkerManagerService(projectRoot, createMockPm2());
  await expect(
    service.claimLegacyChannel(
      "whatsapp",
      "org_a",
      {
        orgId: "org_a",
        profileId: "agent_a",
      },
      db
    )
  ).rejects.toThrow();
  expect(await Bun.file(join(legacyDir, "config.ini")).exists()).toBe(true);
  await mkdir(join(activeDir, "auth"), { recursive: true });
  await writeFile(
    join(activeDir, "auth", "creds.json"),
    JSON.stringify({ me: { id: "123:4@s.whatsapp.net" } })
  );
  await service.migrateAgentChannels(db);

  expect(await service.legacyChannels("org_a", false)).toEqual([]);
  const archived = (await readdir(join(configDir!, "orgs", "org_a"))).find(
    (name) => name.startsWith("whatsapp.duplicate-")
  );
  expect(archived).toBeDefined();
  expect(
    await Bun.file(
      join(configDir!, "orgs", "org_a", archived!, "auth", "creds.json")
    ).exists()
  ).toBe(true);
  expect(await Bun.file(join(activeDir, "config.ini")).exists()).toBe(true);
  expect((await readWorkerDesiredState("org_a")).whatsapp).toBe(false);
});

test("failed stop preserves credentials and blocks owner recovery", async () => {
  const owner = { orgId: "org_a", profileId: "agent_a" };
  await saveWhatsAppConfig({}, owner);
  const pm2 = createMockPm2();
  const service = new WorkerManagerService(projectRoot, pm2);
  (pm2.describe as ReturnType<typeof mock>).mockImplementation((_name, cb) =>
    cb(null, [{}])
  );
  (pm2.delete as ReturnType<typeof mock>).mockImplementation((_name, cb) =>
    cb(new Error("stop failed"))
  );
  await expect(service.disableProfileChannels(owner, true)).rejects.toThrow();
  const { loadWhatsAppConfigFile } = await import(
    "@nakama/core/whatsapp-config"
  );
  expect(await loadWhatsAppConfigFile(owner)).not.toBeNull();
  await expect(service.startWorker("whatsapp", owner)).rejects.toThrow();
  expect((await readWorkerDesiredState(owner)).whatsapp).toBe(false);
  expect(pm2.start).not.toHaveBeenCalled();
});

test("stopped agent logs remain available and clearing keeps sibling logs", async () => {
  const { getChannelConfigDir } = await import(
    "@nakama/core/channel-config-shared"
  );
  const a = { orgId: "org_a", profileId: "agent_a" };
  const b = { orgId: "org_a", profileId: "agent_b" };
  for (const owner of [a, b]) {
    await saveWhatsAppConfig({}, owner);
    await writeFile(
      join(getChannelConfigDir("whatsapp", owner), "stdout.log"),
      owner.profileId + "\n"
    );
  }
  const service = new WorkerManagerService(projectRoot, createMockPm2());
  await service.stopWorker("whatsapp", a);
  expect((await service.getWorkerLogs("whatsapp", 20, a)).stdout).toBe(
    "agent_a"
  );
  await service.clearWorkerLogs("whatsapp", a);
  expect((await service.getWorkerLogs("whatsapp", 20, a)).stdout).toBe("");
  expect((await service.getWorkerLogs("whatsapp", 20, b)).stdout).toBe(
    "agent_b"
  );
});
