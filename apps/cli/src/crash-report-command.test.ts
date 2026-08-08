import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCrashReport,
  readLastCrashReport,
  recordLastCrashReport,
  resetCrashReportConsentCache,
} from "@nakama/core/crash-report";
import {
  isCrashReportShowCommand,
  runCrashReportShow,
} from "./crash-report-command";

let configDir = "";
let previousConfigDir: string | undefined;
let lines: string[] = [];
let originalLog: typeof console.log;

beforeEach(async () => {
  previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  configDir = await mkdtemp(join(tmpdir(), "nakama-report-show-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  process.env.NAKAMA_CRASH_REPORT_DSN = "https://k@ingest.example.com/1";
  resetCrashReportConsentCache();

  lines = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
});

afterEach(async () => {
  console.log = originalLog;

  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }

  delete process.env.NAKAMA_CRASH_REPORT_DSN;
  resetCrashReportConsentCache();
  await rm(configDir, { force: true, recursive: true });
});

function output(): string {
  return lines.join("\n");
}

test("only `report --show` triggers it", () => {
  expect(isCrashReportShowCommand(["report", "--show"])).toBe(true);
  expect(isCrashReportShowCommand(["report"])).toBe(false);
  expect(isCrashReportShowCommand(["rotate-token"])).toBe(false);
  expect(isCrashReportShowCommand([])).toBe(false);
});

test("it says plainly when nothing has been prepared", async () => {
  await runCrashReportShow();

  expect(output()).toContain("No report recorded yet");
  expect(output()).toContain("Consent:   unset");
});

test("it prints where reports go, so that is not something to take on trust", async () => {
  await runCrashReportShow();

  expect(output()).toContain("https://ingest.example.com/api/1/store/");
});

test("it prints the stored report and the exact payload the ingest receives", async () => {
  const report = buildCrashReport(new Error("provider call failed"), {
    source: "server",
  });
  await recordLastCrashReport(report);

  await runCrashReportShow();

  expect(output()).toContain("provider call failed");
  expect(output()).toContain(report.fingerprint);
  expect(output()).toContain("Posted to the ingest as:");
  expect(output()).toContain('"platform": "node"');
});

test("what it prints is the scrubbed report, not the raw error", async () => {
  const report = buildCrashReport(
    new Error(
      'rejected {"name":"Budi"} with key sk-ant-api03-abcdefghijklmnopqrstuvwx'
    ),
    { source: "server" }
  );
  await recordLastCrashReport(report);

  await runCrashReportShow();

  expect(output()).not.toContain("Budi");
  expect(output()).not.toContain("sk-ant-api03");
  expect((await readLastCrashReport())?.message).not.toContain("Budi");
});
