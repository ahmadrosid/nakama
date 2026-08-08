import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  breadcrumb,
  buildCrashReport,
  type CrashReport,
  createCrashContext,
  currentCrashContext,
  fingerprintError,
  MAX_BREADCRUMBS,
  reportError,
  reportInvariant,
  runWithCrashContext,
  setCrashContextIds,
  setCrashLogger,
  setCrashSink,
} from "./crash-report";
import { resetCrashReportConsentCache } from "./crash-report-config";

let configDir = "";
let previousConfigDir: string | undefined;

beforeEach(async () => {
  previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  configDir = await mkdtemp(join(tmpdir(), "nakama-crash-report-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  delete process.env.NAKAMA_CRASH_REPORTS;
  delete process.env.DO_NOT_TRACK;
  resetCrashReportConsentCache();
  setCrashLogger(() => {});
});

afterEach(async () => {
  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }

  delete process.env.NAKAMA_CRASH_REPORTS;
  delete process.env.DO_NOT_TRACK;
  resetCrashReportConsentCache();
  setCrashLogger(null);
  setCrashSink(null);
  await rm(configDir, { force: true, recursive: true });
});

test("breadcrumbs are scoped to the running context", () => {
  const context = createCrashContext({
    route: "POST /v1/sessions",
    source: "server",
  });

  runWithCrashContext(context, () => {
    breadcrumb("route.enter", { method: "POST", status: 200 });
    expect(currentCrashContext()).toBe(context);
  });

  expect(context.breadcrumbs).toHaveLength(1);
  expect(context.breadcrumbs[0]?.kind).toBe("route.enter");
  expect(context.breadcrumbs[0]?.data).toEqual({ method: "POST", status: 200 });
});

test("breadcrumb outside a context is a no-op rather than a throw", () => {
  expect(() => breadcrumb("orphan")).not.toThrow();
});

test("the breadcrumb buffer is bounded and keeps the most recent entries", () => {
  const context = createCrashContext({ source: "server" });

  runWithCrashContext(context, () => {
    for (let index = 0; index < MAX_BREADCRUMBS + 10; index += 1) {
      breadcrumb("tool.call", { count: index });
    }
  });

  expect(context.breadcrumbs).toHaveLength(MAX_BREADCRUMBS);
  expect(context.breadcrumbs[0]?.data).toEqual({ count: 10 });
  expect(context.breadcrumbs.at(-1)?.data).toEqual({
    count: MAX_BREADCRUMBS + 9,
  });
});

test("context ids are hashed, never carried raw", () => {
  const context = createCrashContext({ source: "server" });

  runWithCrashContext(context, () => {
    setCrashContextIds({
      orgId: "org_realid",
      sessionId: null,
      userId: "usr_realid",
    });
  });

  const serialized = JSON.stringify(
    buildCrashReport(new Error("boom"), { context })
  );

  expect(serialized).not.toContain("org_realid");
  expect(serialized).not.toContain("usr_realid");
  expect(context.orgIdHash).toHaveLength(12);
  expect(context.sessionIdHash).toBeUndefined();
});

test("the same bug fingerprints the same across ids and line numbers", () => {
  const first = fingerprintError(
    "TypeError",
    "profile prof_01JABCDEF23 not found",
    "TypeError\n    at resolveProfile (~/src/profiles.ts:12:3)"
  );
  const second = fingerprintError(
    "TypeError",
    "profile prof_01JXYZGHI45 not found",
    "TypeError\n    at resolveProfile (~/src/profiles.ts:48:9)"
  );

  expect(first).toBe(second);
});

test("a uuid in the message does not fragment the fingerprint", () => {
  const stack = "Error\n    at runAutomation (~/src/automation.ts:20:5)";
  const first = fingerprintError(
    "Error",
    "run 3f2504e0-4f89-11d3-9a0c-0305e82c3301 timed out after 30000ms",
    stack
  );
  const second = fingerprintError(
    "Error",
    "run 7c9e6679-7425-40de-944b-e07fc1f90ae7 timed out after 45000ms",
    stack
  );

  expect(first).toBe(second);
});

test("different bugs fingerprint differently", () => {
  const first = fingerprintError(
    "TypeError",
    "a is undefined",
    "TypeError\n    at a (~/a.ts:1:1)"
  );
  const second = fingerprintError(
    "RangeError",
    "b is out of range",
    "RangeError\n    at b (~/b.ts:1:1)"
  );

  expect(first).not.toBe(second);
});

test("the report scrubs the message and stack", () => {
  const error = new Error(
    "auth failed with sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345"
  );
  const report = buildCrashReport(error, { source: "server" });

  expect(report.message).not.toContain("sk-ant-api03");
  expect(report.name).toBe("Error");
  expect(report.runtime.bun).toBe(Bun.version);
});

test("a non-Error rejection still produces a report", () => {
  const report = buildCrashReport("plain string failure", {
    source: "worker:discord",
  });

  expect(report.name).toBe("NonError");
  expect(report.message).toBe("plain string failure");
  expect(report.fingerprint).toHaveLength(16);
});

test("nothing reaches the sink while consent is unset", async () => {
  const delivered: CrashReport[] = [];
  setCrashSink((report) => {
    delivered.push(report);
  });

  await reportError(new Error("boom"), { source: "server" });
  await Bun.sleep(5);

  expect(delivered).toHaveLength(0);
});

test("the sink receives the report once consent is granted", async () => {
  process.env.NAKAMA_CRASH_REPORTS = "1";
  resetCrashReportConsentCache();

  const delivered: CrashReport[] = [];
  setCrashSink((report) => {
    delivered.push(report);
  });

  await reportError(new Error("boom"), { source: "server" });
  await Bun.sleep(5);

  expect(delivered).toHaveLength(1);
  expect(delivered[0]?.kind).toBe("crash");
});

test("DO_NOT_TRACK stops delivery even with a sink installed", async () => {
  process.env.NAKAMA_CRASH_REPORTS = "1";
  process.env.DO_NOT_TRACK = "1";
  resetCrashReportConsentCache();

  const delivered: CrashReport[] = [];
  setCrashSink((report) => {
    delivered.push(report);
  });

  await reportError(new Error("boom"), { source: "server" });
  await Bun.sleep(5);

  expect(delivered).toHaveLength(0);
});

test("a sink that throws never surfaces to the caller", async () => {
  process.env.NAKAMA_CRASH_REPORTS = "1";
  resetCrashReportConsentCache();
  setCrashSink(() => {
    throw new Error("sink is down");
  });

  await expect(
    reportError(new Error("boom"), { source: "server" })
  ).resolves.toBeDefined();
  await Bun.sleep(5);
});

test("the local log always runs, consent or not", async () => {
  const logged: CrashReport[] = [];
  setCrashLogger((report) => {
    logged.push(report);
  });

  await reportError(new Error("boom"), { source: "cli" });

  expect(logged).toHaveLength(1);
  expect(logged[0]?.source).toBe("cli");
});

test("reportInvariant marks the report as an unmet expectation", async () => {
  const report = await reportInvariant("automation run never completed", {
    source: "worker:automation",
  });

  expect(report.kind).toBe("invariant");
  expect(report.message).toBe("automation run never completed");
});

test("the report carries the request id and route for correlation", async () => {
  const context = createCrashContext({
    requestId: "req-123",
    route: "POST /v1/sessions",
    source: "server",
  });

  const report = await runWithCrashContext(context, () =>
    reportError(new Error("boom"))
  );

  expect(report.requestId).toBe("req-123");
  expect(report.route).toBe("POST /v1/sessions");
  expect(report.source).toBe("server");
});
