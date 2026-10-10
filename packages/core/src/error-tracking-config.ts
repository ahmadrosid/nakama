import { join } from "node:path";
import { parseIni, readTextOrNull, writeTextFile } from "./fs";
import { maskTrailingSecret } from "./secret-mask";
import { getUserConfigDir } from "./user-config";

export interface ErrorTrackingTestResult {
  at: string;
  delivered: boolean;
}

export interface ErrorTrackingConfig {
  dsn: string | null;
  lastTest?: ErrorTrackingTestResult | null;
  savedAt?: string | null;
}

const TRUTHY = ["1", "true", "on", "yes"];

export function getErrorTrackingConfigDir(): string {
  return join(getUserConfigDir(), "error-tracking");
}

export function getErrorTrackingConfigPath(): string {
  return join(getErrorTrackingConfigDir(), "config.ini");
}

export async function loadErrorTrackingConfig(): Promise<ErrorTrackingConfig> {
  const raw = await readTextOrNull(getErrorTrackingConfigPath());

  if (raw === null) {
    return { dsn: null };
  }

  const values = parseIni(raw);
  const dsn = values.dsn?.trim() || null;

  if (!dsn) {
    return { dsn: null };
  }

  const lastTestAt = values.last_test_at?.trim();

  return {
    dsn,
    lastTest: lastTestAt
      ? { at: lastTestAt, delivered: values.last_test_delivered === "true" }
      : null,
    savedAt: values.saved_at?.trim() || null,
  };
}

/**
 * Every caller routes through here, so DO_NOT_TRACK cannot be forgotten at one call
 * site. It is the cross-tool convention and beats a stored DSN rather than the other
 * way round: an operator who sets it wants nothing leaving the box.
 */
export function resolveErrorTrackingDsn(
  file: Pick<ErrorTrackingConfig, "dsn">,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (TRUTHY.includes(env.DO_NOT_TRACK?.trim().toLowerCase() ?? "")) {
    return null;
  }

  // Set but empty means off. Falling through to the stored value would make
  // NAKAMA_ERROR_TRACKING_DSN="" keep delivering, the opposite of what it asks for.
  const fromEnv = env.NAKAMA_ERROR_TRACKING_DSN;

  if (fromEnv !== undefined) {
    return fromEnv.trim() || null;
  }

  return file.dsn;
}

async function writeErrorTrackingConfig(
  config: ErrorTrackingConfig
): Promise<void> {
  const lines = [
    "# Nakama error tracking",
    "# dsn = a Sentry-compatible DSN (Sentry, GlitchTip, Bugsink, Rustrak, self-hosted).",
    "# Empty or missing sends nothing. DO_NOT_TRACK=1 overrides this file.",
    ...(config.dsn ? [`dsn=${config.dsn}`] : []),
    ...(config.dsn && config.savedAt ? [`saved_at=${config.savedAt}`] : []),
    ...(config.dsn && config.lastTest
      ? [
          `last_test_at=${config.lastTest.at}`,
          `last_test_delivered=${config.lastTest.delivered}`,
        ]
      : []),
    "",
  ];

  await writeTextFile(getErrorTrackingConfigPath(), lines.join("\n"), {
    ensureDir: getErrorTrackingConfigDir(),
  });
}

/**
 * Callers must follow this with refreshErrorTrackingEnabled(): reportError reads a
 * cached flag so it can decide synchronously, and the file alone does not move it.
 * A new DSN drops the last test result: it was a verdict on the old one.
 */
export async function saveErrorTrackingDsn(
  dsn: string | null,
  now: Date = new Date()
): Promise<ErrorTrackingConfig> {
  const trimmed = dsn?.trim() || null;

  const next: ErrorTrackingConfig = trimmed
    ? { dsn: trimmed, lastTest: null, savedAt: now.toISOString() }
    : { dsn: null };

  await writeErrorTrackingConfig(next);

  return next;
}

export async function saveErrorTrackingTestResult(
  delivered: boolean,
  now: Date = new Date()
): Promise<void> {
  const current = await loadErrorTrackingConfig();

  if (!current.dsn) {
    return;
  }

  await writeErrorTrackingConfig({
    ...current,
    lastTest: { at: now.toISOString(), delivered },
  });
}

export async function isErrorTrackingEnabled(): Promise<boolean> {
  return resolveErrorTrackingDsn(await loadErrorTrackingConfig()) !== null;
}

export interface ErrorTrackingSettingsPublic {
  configured: boolean;
  dsnMasked: string | null;
  lastTest: ErrorTrackingTestResult | null;
  savedAt: string | null;
}

/**
 * The raw DSN never leaves the server. It carries the operator's ingest key, and an
 * API response is the easiest place for it to end up in a log or a browser cache.
 */
export async function loadErrorTrackingSettingsPublic(): Promise<ErrorTrackingSettingsPublic> {
  const { dsn, lastTest, savedAt } = await loadErrorTrackingConfig();

  return {
    configured: Boolean(dsn),
    dsnMasked: dsn ? maskTrailingSecret(dsn) : null,
    lastTest: lastTest ?? null,
    savedAt: savedAt ?? null,
  };
}
