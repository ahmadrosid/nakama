import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CrashReport, setCrashLogger } from "@nakama/core/crash-report";
import { AuthService } from "../services/auth-service";
import { createHonoApp } from "./app";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
let testConfigDir = "";
let reports: CrashReport[] = [];

beforeAll(() => {
  testConfigDir = mkdtempSync(join(tmpdir(), "nakama-crash-http-"));
  process.env.NAKAMA_CONFIG_DIR = testConfigDir;
});

afterAll(() => {
  if (originalConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
  }

  rmSync(testConfigDir, { force: true, recursive: true });
});

beforeEach(() => {
  reports = [];
  setCrashLogger((report) => {
    reports.push(report);
  });
});

afterEach(() => {
  setCrashLogger(null);
});

function createApp(countHumanUsers: () => Promise<number>) {
  return createHonoApp({
    agent: { providerConfigured: true } as any,
    authService: new AuthService(),
    automationService: {} as any,
    databaseAdapter: {
      countHumanUsers,
      countUsers: async () => 1,
      getUserByEmail: async () => null,
    } as any,
    mcpService: {} as any,
    orgService: {} as any,
    systemStatus: { getStatus: async () => ({ ok: true }) } as any,
    taskService: {} as any,
    webDistDir: null,
    workerManager: {} as any,
  });
}

test("every response carries a request id", async () => {
  const app = createApp(async () => 1);
  const response = await app.fetch(new Request("http://localhost:4310/health"));

  expect(response.status).toBe(200);
  expect(response.headers.get("x-request-id")).toBeTruthy();
});

test("an inbound request id is kept so a client and server log line join up", async () => {
  const app = createApp(async () => 1);
  const response = await app.fetch(
    new Request("http://localhost:4310/health", {
      headers: { "x-request-id": "req-from-client" },
    })
  );

  expect(response.headers.get("x-request-id")).toBe("req-from-client");
});

test("a server-side failure is reported with its route and request id", async () => {
  const app = createApp(async () => {
    throw new Error("database is gone");
  });

  const response = await app.fetch(
    new Request("http://localhost:4310/health", {
      headers: { "x-request-id": "req-crash" },
    })
  );

  expect(response.status).toBe(500);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.source).toBe("server");
  expect(reports[0]?.requestId).toBe("req-crash");
  expect(reports[0]?.route).toContain("/health");
  expect(reports[0]?.fingerprint).toHaveLength(16);
});

test("a rejected request is not reported as a crash", async () => {
  const app = createApp(async () => 1);
  const response = await app.fetch(
    new Request("http://localhost:4310/v1/system/status")
  );

  expect(response.status).toBe(401);
  expect(reports).toHaveLength(0);
});
