import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CRASH_REPORT_DSN,
  getCrashReportConfigPath,
  isCrashReportingAllowed,
  loadCrashReportConfig,
  readCrashReportEnvOverride,
  resetCrashReportConsentCache,
  resolveCrashReportConsent,
  resolveCrashReportDsn,
  saveCrashReportConsent,
} from "./crash-report";

let configDir = "";
let previousConfigDir: string | undefined;

beforeEach(async () => {
  previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  configDir = await mkdtemp(join(tmpdir(), "nakama-crash-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  delete process.env.NAKAMA_CRASH_REPORTS;
  delete process.env.DO_NOT_TRACK;
  resetCrashReportConsentCache();
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
  await rm(configDir, { force: true, recursive: true });
});

test("a fresh install has never been asked and sends nothing", async () => {
  expect(await loadCrashReportConfig()).toEqual({
    consent: "unset",
    dsn: null,
    installId: null,
  });
  expect(await isCrashReportingAllowed()).toBe(false);
});

test("granting consent mints an install id and persists the answer", async () => {
  const saved = await saveCrashReportConsent("granted");

  expect(saved.consent).toBe("granted");
  expect(saved.installId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await loadCrashReportConfig()).toEqual(saved);
  expect(await isCrashReportingAllowed()).toBe(true);
});

test("granting twice keeps the same install id", async () => {
  const first = await saveCrashReportConsent("granted");
  const second = await saveCrashReportConsent("granted");

  expect(second.installId).toBe(first.installId);
});

test("denying drops the install id", async () => {
  await saveCrashReportConsent("granted");
  const denied = await saveCrashReportConsent("denied");

  expect(denied.installId).toBeNull();
  expect(await isCrashReportingAllowed()).toBe(false);
});

test("the consent file is written with private permissions", async () => {
  await saveCrashReportConsent("granted");
  const { mode } = await Bun.file(getCrashReportConfigPath()).stat();
  // biome-ignore lint/suspicious/noBitwiseOperators: file mode bits
  expect(mode & 0o777).toBe(0o600);
});

test("DO_NOT_TRACK overrides a stored grant", async () => {
  await saveCrashReportConsent("granted");
  process.env.DO_NOT_TRACK = "1";

  expect(await isCrashReportingAllowed()).toBe(false);
});

test("NAKAMA_CRASH_REPORTS settles the answer for a headless install", () => {
  const unset = { consent: "unset", installId: null } as const;

  expect(resolveCrashReportConsent(unset, { NAKAMA_CRASH_REPORTS: "1" })).toBe(
    "granted"
  );
  expect(
    resolveCrashReportConsent(unset, { NAKAMA_CRASH_REPORTS: "off" })
  ).toBe("denied");
  expect(resolveCrashReportConsent(unset, {})).toBe("unset");
});

test("DO_NOT_TRACK beats NAKAMA_CRASH_REPORTS", () => {
  expect(
    readCrashReportEnvOverride({ DO_NOT_TRACK: "1", NAKAMA_CRASH_REPORTS: "1" })
  ).toBe("denied");
});

test("an empty NAKAMA_CRASH_REPORT_DSN turns delivery off rather than falling back", () => {
  const file = { consent: "unset", dsn: null, installId: null } as const;

  expect(
    resolveCrashReportDsn(file, { NAKAMA_CRASH_REPORT_DSN: "" })
  ).toBeNull();
  expect(
    resolveCrashReportDsn(file, { NAKAMA_CRASH_REPORT_DSN: "https://k@h/1" })
  ).toBe("https://k@h/1");
});

test("the built-in ingest is used when nothing overrides it", () => {
  const resolved = resolveCrashReportDsn(
    { consent: "unset", dsn: null, installId: null },
    {}
  );

  expect(resolved).toBe(DEFAULT_CRASH_REPORT_DSN);
});

test("a dsn in the config file beats the built-in default", () => {
  const resolved = resolveCrashReportDsn(
    {
      consent: "unset",
      dsn: "https://own@ingest.example.com/9",
      installId: null,
    },
    {}
  );

  expect(resolved).toBe("https://own@ingest.example.com/9");
});

test("an unreadable config never enables reporting", async () => {
  process.env.NAKAMA_CONFIG_DIR = join(configDir, "does-not-exist");
  resetCrashReportConsentCache();

  expect(await isCrashReportingAllowed()).toBe(false);
});
