import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendPendingCrashReport,
  buildCrashReport,
  type CrashReport,
  clearPendingCrashReports,
  flushPendingCrashReports,
  MAX_PENDING_CRASH_REPORTS,
  readPendingCrashReports,
  reportError,
  resetCrashReportConsentCache,
  saveCrashReportConsent,
  setCrashLogger,
  setCrashSink,
} from "./crash-report";

let configDir = "";
let previousConfigDir: string | undefined;

beforeEach(async () => {
  previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  configDir = await mkdtemp(join(tmpdir(), "nakama-pending-"));
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

function reportWithMessage(message: string): CrashReport {
  return buildCrashReport(new Error(message), { source: "server" });
}

test("a crash loop does not push the other bugs out of the pending file", async () => {
  const repeated = reportWithMessage("same bug");

  await appendPendingCrashReport(repeated);
  await appendPendingCrashReport(repeated);
  await appendPendingCrashReport(repeated);

  expect(await readPendingCrashReports()).toHaveLength(1);
});

test("the pending file is bounded", async () => {
  // Distinct wording, not a counter: the fingerprint normalizes numbers away, so
  // "bug 1" and "bug 2" are correctly one bug and would be deduplicated instead.
  const distinctBugs = [
    "alpha broke",
    "beta broke",
    "gamma broke",
    "delta broke",
    "epsilon broke",
  ];

  for (const message of distinctBugs) {
    await appendPendingCrashReport(reportWithMessage(message));
  }

  expect(await readPendingCrashReports()).toHaveLength(
    MAX_PENDING_CRASH_REPORTS
  );
});

test("a corrupt pending file reads as empty rather than throwing", async () => {
  await Bun.write(join(configDir, "crash-reports-pending.json"), "{not json");

  expect(await readPendingCrashReports()).toEqual([]);
});

test("an unanswered install holds the crash instead of sending it", async () => {
  const delivered: CrashReport[] = [];
  setCrashSink((report) => {
    delivered.push(report);
  });

  await reportError(new Error("held for later"), { source: "server" });

  expect(delivered).toHaveLength(0);
  expect(await readPendingCrashReports()).toHaveLength(1);
});

test("a declined install holds nothing", async () => {
  await saveCrashReportConsent("denied");

  await reportError(new Error("not wanted"), { source: "server" });

  expect(await readPendingCrashReports()).toHaveLength(0);
});

test("a consenting install sends live and holds nothing", async () => {
  await saveCrashReportConsent("granted");

  const delivered: CrashReport[] = [];
  setCrashSink((report) => {
    delivered.push(report);
  });

  await reportError(new Error("send it"), { source: "server" });
  await Bun.sleep(5);

  expect(delivered).toHaveLength(1);
  expect(await readPendingCrashReports()).toHaveLength(0);
});

test("flushing keeps reports that the sink rejects", async () => {
  await saveCrashReportConsent("granted");
  await appendPendingCrashReport(reportWithMessage("will fail"));
  setCrashSink(async () => {
    throw new Error("ingest down");
  });

  expect(await flushPendingCrashReports()).toBe(0);
  expect(await readPendingCrashReports()).toHaveLength(1);
});

test("saying yes later sends what was held and empties the file", async () => {
  const delivered: CrashReport[] = [];
  setCrashSink((report) => {
    delivered.push(report);
  });

  await reportError(new Error("held until consent"), { source: "server" });
  expect(await readPendingCrashReports()).toHaveLength(1);
  expect(delivered).toHaveLength(0);

  await saveCrashReportConsent("granted");

  expect(await flushPendingCrashReports()).toBe(1);
  expect(delivered).toHaveLength(1);
  expect(await readPendingCrashReports()).toHaveLength(0);
});

test("flushing without consent sends nothing and keeps the file", async () => {
  const delivered: CrashReport[] = [];
  setCrashSink((report) => {
    delivered.push(report);
  });

  await reportError(new Error("still waiting"), { source: "server" });

  expect(await flushPendingCrashReports()).toBe(0);
  expect(delivered).toHaveLength(0);
  expect(await readPendingCrashReports()).toHaveLength(1);
});

test("clearing empties the file", async () => {
  await appendPendingCrashReport(reportWithMessage("gone soon"));
  await clearPendingCrashReports();

  expect(await readPendingCrashReports()).toEqual([]);
});
