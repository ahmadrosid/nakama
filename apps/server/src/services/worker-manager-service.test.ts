import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkerDesiredState, setWorkerDesiredRunning } from "@nakama/core";
import { getChannelConfigDir } from "@nakama/core/channel-config-shared";
import { saveWhatsAppConfig } from "@nakama/core/whatsapp-config";
import { WorkerManagerService } from "./worker-manager-service";

interface Pm2Common {
  prepareAppConf(
    options: { cwd: string },
    app: Parameters<Pm2Client["start"]>[0]
  ): { env: Record<string, string | undefined> };
}

// SAFETY: pm2 ships no types for this module; this is its exported shape.
const { prepareAppConf } = createRequire(import.meta.url)(
  "pm2/lib/Common.js"
) as Pm2Common;

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
  test("worker actions reject an unknown worker", async () => {
    const service = new WorkerManagerService(projectRoot, createMockPm2());

    for (const method of [
      "startWorker",
      "stopWorker",
      "restartWorker",
      "getWorkerLogs",
      "clearWorkerLogs",
    ] as const) {
      const result =
        method === "getWorkerLogs"
          ? service.getWorkerLogs("foobar", 10)
          : service[method]("foobar");

      await expect(result).rejects.toThrow();
    }
  });

  test("recovery starts a worker whose old heartbeat pid now names another process", async () => {
    const owner = { orgId: "org_a", profileId: "agent_a" };
    const dir = getChannelConfigDir("telegram", owner);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.ini"), "bot_token=1:token\n");

    // After a VM restart the old worker's pid can belong to any live process.
    await writeFile(
      join(dir, "worker-heartbeat.json"),
      JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString() })
    );

    await setWorkerDesiredRunning("telegram", true, owner);
    await setWorkerDesiredRunning("automation", false);
    const pm2 = createMockPm2();
    await new WorkerManagerService(projectRoot, pm2).recoverDesiredWorkers();
    // SAFETY: The test fixture matches the contract used by this test.
    const starts = (pm2.start as ReturnType<typeof mock>).mock.calls;
    expect(starts).toHaveLength(1);
    expect(starts[0][0].env.NAKAMA_CHANNEL_PROFILE_ID).toBe(owner.profileId);
  });

  describe("isValidWorker", () => {
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
      // SAFETY: The test fixture matches the contract used by this test.
      const calls = (pm2.start as ReturnType<typeof mock>).mock.calls;
      expect(calls[0][0].name).not.toBe(calls[1][0].name);
      expect(calls[0][0].env.NAKAMA_WHATSAPP_ORG_ID).toBe("org_a");
      expect(calls[1][0].env.NAKAMA_WHATSAPP_ORG_ID).toBe("org_b");
      // SAFETY: The test fixture matches the contract used by this test.
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
      // SAFETY: The test fixture matches the contract used by this test.
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.script).toBe("bun");
      expect(opts.args).toContain("apps/platform/telegram/src/index.ts");
      expect(opts.interpreter).toBeUndefined();
      expect(opts.name).toBe("telegram");
      expect(await readWorkerDesiredState()).toEqual({
        automation: true,
        discord: false,
        slack: false,
        teams: false,
        telegram: true,
        whatsapp: false,
      });
    });

    test("starts whatsapp worker", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.startWorker("whatsapp");

      expect(mockPm2.start).toHaveBeenCalledTimes(1);
      // SAFETY: The test fixture matches the contract used by this test.
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.name).toBe("whatsapp");
      expect(opts.script).toBe("bun");
      expect(opts.args).toContain("apps/platform/whatsapp/src/index.ts");
      expect(opts.interpreter).toBeUndefined();
    });

    test("keeps secrets out of the worker environment", async () => {
      const secrets = [
        "NAKAMA_SECRETS_KEY",
        "NAKAMA_SECRETS_KEY_NEXT",
        "NAKAMA_EMAIL_PASSWORD",
        "OPENAI_API_KEY",
      ];

      for (const key of secrets) {
        process.env[key] = "server-only-secret";
      }

      process.env.NAKAMA_WORKER_TEST_PLAIN = "kept";

      try {
        const mockPm2 = createMockPm2();
        const service = new WorkerManagerService(projectRoot, mockPm2);

        await service.startWorker("telegram");

        // SAFETY: The test fixture matches the contract used by this test.
        const opts = (mockPm2.start as ReturnType<typeof mock>).mock
          .calls[0][0];

        const app = prepareAppConf({ cwd: projectRoot }, { ...opts });

        expect(secrets.filter((key) => key in app.env)).toEqual([]);
        expect(app.env.NAKAMA_WORKER_TEST_PLAIN).toBe("kept");
        expect(app.env.NAKAMA_CONFIG_DIR).toBe(configDir ?? undefined);
      } finally {
        for (const key of [...secrets, "NAKAMA_WORKER_TEST_PLAIN"]) {
          delete process.env[key];
        }
      }
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
      // SAFETY: The test fixture matches the contract used by this test.
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.name).toBe("automation");
      expect(opts.script).toBe("bun");
      expect(opts.args).toContain("apps/platform/automation/src/index.ts");
      expect(opts.interpreter).toBeUndefined();
      expect(await readWorkerDesiredState()).toEqual({
        automation: true,
        discord: false,
        slack: false,
        teams: false,
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

      // SAFETY: The test fixture matches the contract used by this test.
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

      // SAFETY: The test fixture matches the contract used by this test.
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

      // SAFETY: The test fixture matches the contract used by this test.
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.args).toContain("apps/platform/automation/dist/index.js");

      await rm(tmpProjectRoot, { force: true, recursive: true });
    });

    test("throws when PM2 start fails", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.start = mock(
        (
          _opts: Parameters<Pm2Client["start"]>[0],
          cb: (err: Error | null) => void
        ) => cb(new Error("PM2 start failed"))
      );
      const service = new WorkerManagerService(projectRoot, mockPm2);

      expect(service.startWorker("telegram")).rejects.toThrow(
        "PM2 start failed"
      );
    });
  });

  describe("stopWorker", () => {
    test("a restore pause stops the process and preserves desired recovery state", async () => {
      await setWorkerDesiredRunning("automation", true);
      const pm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, pm2);
      await service.stopWorker("automation", null, true);
      expect(pm2.stop).toHaveBeenCalled();
      expect((await readWorkerDesiredState()).automation).toBe(true);
    });

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
        teams: false,
        telegram: false,
        whatsapp: false,
      });
    });
  });

  describe("restartWorker", () => {});

  describe("getWorkerStatus", () => {
    test("returns managed status for running worker", async () => {
      const mockPm2 = createMockPm2();
      mockPm2.list = mock((cb: Parameters<Pm2Client["list"]>[0]) =>
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
      mockPm2.list = mock((cb: Parameters<Pm2Client["list"]>[0]) =>
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
        error: "PM2 daemon not running",
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
});
