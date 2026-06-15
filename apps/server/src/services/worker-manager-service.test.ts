import { describe, expect, test, mock } from "bun:test";
import { WorkerManagerService } from "./worker-manager-service";

function createMockPm2() {
  const mockPm2 = {
    connect: mock((cb: (err: Error | null) => void) => cb(null)),
    disconnect: mock(() => {}),
    start: mock((_opts: unknown, cb: (err: Error | null) => void) => cb(null)),
    stop: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    restart: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    list: mock((cb: (err: Error | null, list: unknown[]) => void) => cb(null, [])),
  };

  return mockPm2 as unknown as typeof import("pm2");
}

const projectRoot = "/tmp/test-project";

describe("WorkerManagerService", () => {
  describe("CJS interop", () => {
    test("ensurePm2 unwraps default from dynamic import", async () => {
      const mod = await import("pm2");
      const pm2 = (mod.default ?? mod) as typeof import("pm2");
      expect(typeof pm2.connect).toBe("function");
      expect(typeof pm2.start).toBe("function");
      expect(typeof pm2.stop).toBe("function");
      expect(typeof pm2.list).toBe("function");
      expect(typeof pm2.disconnect).toBe("function");
    });
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

      expect(mockPm2.start).toHaveBeenCalledTimes(1);
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.script).toBe("bun");
      expect(opts.args).toContain("apps/platform/telegram/src/index.ts");
      expect(opts.name).toBe("telegram");
    });

    test("starts whatsapp worker", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.startWorker("whatsapp");

      expect(mockPm2.start).toHaveBeenCalledTimes(1);
      const opts = (mockPm2.start as ReturnType<typeof mock>).mock.calls[0][0];
      expect(opts.name).toBe("whatsapp");
      expect(opts.args).toContain("apps/platform/whatsapp/src/index.ts");
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
    });

    test("throws for unknown worker", async () => {
      const service = new WorkerManagerService(projectRoot, createMockPm2());
      expect(service.stopWorker("foobar")).rejects.toThrow("Unknown worker");
    });
  });

  describe("restartWorker", () => {
    test("restarts worker by name", async () => {
      const mockPm2 = createMockPm2();
      const service = new WorkerManagerService(projectRoot, mockPm2);

      await service.restartWorker("telegram");

      expect(mockPm2.restart).toHaveBeenCalledWith("telegram", expect.any(Function));
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
});
