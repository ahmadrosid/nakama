import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildErrorReport,
  type ErrorReport,
  fingerprintError,
  flushPendingErrorReports,
  refreshErrorTrackingEnabled,
  reportError,
  setErrorSink,
} from "./error-tracking";
import { saveErrorTrackingDsn } from "./error-tracking-config";
import {
  getPendingErrorReportsPath,
  MAX_PENDING_ERROR_REPORTS,
  readPendingErrorReports,
} from "./error-tracking-queue";

const DSN = "https://key@errors.example.com/7";

let configDir = "";
let previousConfigDir: string | undefined;
// reportError logs straight to console.error, so the capture lives here in the
// test rather than as an injection point in the module under test.
let consoleErrorCalls: unknown[][] = [];
const realConsoleError = console.error;

beforeEach(async () => {
  previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  configDir = await mkdtemp(join(tmpdir(), "nakama-error-tracking-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  delete process.env.NAKAMA_ERROR_TRACKING_DSN;
  delete process.env.DO_NOT_TRACK;
  await saveErrorTrackingDsn(DSN);
  await refreshErrorTrackingEnabled();
  consoleErrorCalls = [];
  console.error = (...args: unknown[]) => {
    consoleErrorCalls.push(args);
  };
});

afterEach(async () => {
  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }

  delete process.env.NAKAMA_ERROR_TRACKING_DSN;
  delete process.env.DO_NOT_TRACK;
  await refreshErrorTrackingEnabled();
  console.error = realConsoleError;
  setErrorSink(null);
  await rm(configDir, { force: true, recursive: true });
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
  const report = buildErrorReport(error, { source: "server" });

  expect(report.message).not.toContain("sk-ant-api03");
  expect(report.name).toBe("Error");
  expect(report.runtime.bun).toBe(Bun.version);
});

test("a non-Error rejection still produces a report", () => {
  const report = buildErrorReport("plain string failure", {
    source: "worker:discord",
  });

  expect(report.name).toBe("NonError");
  expect(report.message).toBe("plain string failure");
  expect(report.fingerprint).toHaveLength(16);
});

test("a circular rejection reports rather than throwing, at a shared fingerprint", () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;

  const report = buildErrorReport(circular, { source: "worker:discord" });
  const other: { self?: unknown; kind?: string } = { kind: "different" };
  other.self = other;

  expect(report.fingerprint).toHaveLength(16);
  // Documented, not desired: JSON.stringify throws on a cycle and String() flattens every
  // one of them to "[object Object]", so two unrelated circular rejections share an issue.
  expect(buildErrorReport(other).fingerprint).toBe(report.fingerprint);
});

test("with no sink installed nothing is queued and nothing is sent", async () => {
  setErrorSink(null);

  await reportError(new Error("boom"), { source: "server" });

  expect(readPendingErrorReports()).toHaveLength(0);
});

test("the sink receives the report", async () => {
  const delivered: ErrorReport[] = [];
  setErrorSink((report) => {
    delivered.push(report);
    return true;
  });

  await reportError(new Error("boom"), { source: "server" });
  await Bun.sleep(5);

  expect(delivered).toHaveLength(1);
  expect(delivered[0]?.kind).toBe("crash");
});

test("a delivered report is dropped from the queue", async () => {
  setErrorSink(() => true);

  await reportError(new Error("boom"), { source: "server" });

  expect(readPendingErrorReports()).toHaveLength(0);
});

test("a report the sink could not deliver stays queued for the next start", async () => {
  setErrorSink(() => {
    throw new Error("ingest down");
  });

  const report = await reportError(new Error("boom"), { source: "server" });
  const queued = readPendingErrorReports();

  expect(queued).toHaveLength(1);
  expect(queued[0]?.id).toBe(report.id);
});

test("the queue is written before the send, which is what survives a hard exit", async () => {
  // An uncaught exception kills the process mid-send, so the write has to have
  // happened by the time the sink is first entered.
  let queuedWhenSinkRan = 0;
  setErrorSink(() => {
    queuedWhenSinkRan = readPendingErrorReports().length;
    return true;
  });

  await reportError(new Error("boom"), { source: "server" });

  expect(queuedWhenSinkRan).toBe(1);
});

test("flushPendingErrorReports drains what the last process left behind", async () => {
  setErrorSink(() => {
    throw new Error("ingest down");
  });
  await reportError(new Error("boom"), { source: "server" });
  expect(readPendingErrorReports()).toHaveLength(1);

  const delivered: ErrorReport[] = [];
  setErrorSink((report) => {
    delivered.push(report);
    return true;
  });

  expect(await flushPendingErrorReports()).toBe(1);
  expect(delivered).toHaveLength(1);
  expect(readPendingErrorReports()).toHaveLength(0);
});

test("the queue keeps the most recent reports and stops growing", async () => {
  setErrorSink(() => {
    throw new Error("ingest down");
  });

  for (let i = 0; i < MAX_PENDING_ERROR_REPORTS + 3; i += 1) {
    await reportError(new Error(`boom ${i}`), { source: "server" });
  }

  const queued = readPendingErrorReports();
  expect(queued).toHaveLength(MAX_PENDING_ERROR_REPORTS);
  expect(queued.at(-1)?.message).toContain(
    `boom ${MAX_PENDING_ERROR_REPORTS + 2}`
  );
});

test("with no DSN configured the queue file is never created", async () => {
  // Asserting an empty queue would pass for the wrong reason: the report gets
  // written and then removed. The file must not appear at all.
  await saveErrorTrackingDsn(null);
  await refreshErrorTrackingEnabled();
  setErrorSink(() => true);

  await reportError(new Error("boom"), { source: "server" });

  expect(existsSync(getPendingErrorReportsPath())).toBe(false);
});

test("a sink that did not deliver leaves the report queued", async () => {
  // A sink returns false when it had nowhere to send. That must not look like
  // success, or the report is dropped and counted as delivered.
  setErrorSink(() => false);

  await reportError(new Error("boom"), { source: "server" });
  expect(readPendingErrorReports()).toHaveLength(1);

  expect(await flushPendingErrorReports()).toBe(0);
  expect(readPendingErrorReports()).toHaveLength(1);
});

test("a corrupt queue file reads as empty rather than throwing", async () => {
  await writeFile(getPendingErrorReportsPath(), "{not json", "utf8");

  expect(readPendingErrorReports()).toHaveLength(0);
});

test("the local log always runs, configured or not", async () => {
  await reportError(new Error("boom"), { source: "cli" });

  expect(consoleErrorCalls).toHaveLength(1);
  expect(consoleErrorCalls[0]?.[0]).toMatch(
    /^\[nakama:crash\] cli [0-9a-f]{16}$/
  );
});
