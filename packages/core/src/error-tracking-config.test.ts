import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getErrorTrackingConfigPath,
  isErrorTrackingEnabled,
  loadErrorTrackingConfig,
  loadErrorTrackingSettingsPublic,
  resolveErrorTrackingDsn,
  saveErrorTrackingDsn,
  saveErrorTrackingTestResult,
} from "./error-tracking-config";

const DSN = "https://key@errors.example.com/7";

let configDir = "";

let previousConfigDir: string | undefined;

beforeEach(async () => {
  previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  configDir = await mkdtemp(join(tmpdir(), "nakama-error-tracking-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  delete process.env.NAKAMA_ERROR_TRACKING_DSN;
  delete process.env.DO_NOT_TRACK;
});

afterEach(async () => {
  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }

  delete process.env.NAKAMA_ERROR_TRACKING_DSN;
  delete process.env.DO_NOT_TRACK;
  await rm(configDir, { force: true, recursive: true });
});

test("an install with no config file reports nothing", async () => {
  expect(await loadErrorTrackingConfig()).toEqual({ dsn: null });
  expect(await isErrorTrackingEnabled()).toBe(false);
});

test("a saved DSN round trips and enables reporting", async () => {
  await saveErrorTrackingDsn(DSN);

  expect(await loadErrorTrackingConfig()).toMatchObject({ dsn: DSN });
  expect(await isErrorTrackingEnabled()).toBe(true);
});

test("the config file is written private, and readable as ini", async () => {
  await saveErrorTrackingDsn(DSN);

  const path = getErrorTrackingConfigPath();
  expect(await readFile(path, "utf8")).toContain(`dsn=${DSN}`);

  if (process.platform !== "win32") {
    expect((await stat(path)).mode.toString(8).slice(-3)).toBe("600");
  }
});

test("clearing the DSN leaves the file with no dsn line", async () => {
  await saveErrorTrackingDsn(DSN);
  await saveErrorTrackingDsn(null);

  expect(await loadErrorTrackingConfig()).toEqual({ dsn: null });
  expect(await readFile(getErrorTrackingConfigPath(), "utf8")).not.toContain(
    "dsn="
  );
});

test("DO_NOT_TRACK beats a stored DSN", () => {
  expect(
    resolveErrorTrackingDsn({ dsn: DSN }, { DO_NOT_TRACK: "1" })
  ).toBeNull();
  expect(
    resolveErrorTrackingDsn({ dsn: DSN }, { DO_NOT_TRACK: "true" })
  ).toBeNull();
  expect(resolveErrorTrackingDsn({ dsn: DSN }, { DO_NOT_TRACK: "0" })).toBe(
    DSN
  );
});

test("the env DSN overrides the file, and an empty one means off", () => {
  const env = { NAKAMA_ERROR_TRACKING_DSN: "https://other@example.com/9" };
  expect(resolveErrorTrackingDsn({ dsn: DSN }, env)).toBe(
    "https://other@example.com/9"
  );
  expect(
    resolveErrorTrackingDsn({ dsn: DSN }, { NAKAMA_ERROR_TRACKING_DSN: "" })
  ).toBeNull();
});

test("a test result is kept until the DSN changes", async () => {
  const savedAt = new Date("2026-10-01T10:00:00.000Z");
  const testedAt = new Date("2026-10-02T11:00:00.000Z");

  await saveErrorTrackingDsn(DSN, savedAt);
  await saveErrorTrackingTestResult(false, testedAt);

  expect(await loadErrorTrackingSettingsPublic()).toMatchObject({
    lastTest: { at: testedAt.toISOString(), delivered: false },
    savedAt: savedAt.toISOString(),
  });
  expect(await loadErrorTrackingConfig()).toMatchObject({ dsn: DSN });

  await saveErrorTrackingDsn("https://other@errors.example.com/8");

  expect((await loadErrorTrackingSettingsPublic()).lastTest).toBeNull();
});

test("a test result is not stored without a DSN", async () => {
  await saveErrorTrackingTestResult(true);

  expect(await loadErrorTrackingSettingsPublic()).toMatchObject({
    configured: false,
    lastTest: null,
    savedAt: null,
  });
});
