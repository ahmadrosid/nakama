import { join } from "node:path";
import { parseIni, readTextOrNull, writeTextFile } from "./fs";
import { maskTrailingSecret } from "./secret-mask";
import { getUserConfigDir } from "./user-config";

export interface ErrorTrackingConfig {
  dsn: string | null;
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

  return { dsn: parseIni(raw).dsn?.trim() || null };
}

/**
 * Every caller routes through here, so DO_NOT_TRACK cannot be forgotten at one call
 * site. It is the cross-tool convention and beats a stored DSN rather than the other
 * way round: an operator who sets it wants nothing leaving the box.
 */
export function resolveErrorTrackingDsn(
  file: ErrorTrackingConfig,
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

/**
 * Callers must follow this with refreshErrorTrackingEnabled(): reportError reads a
 * cached flag so it can decide synchronously, and the file alone does not move it.
 */
export async function saveErrorTrackingDsn(
  dsn: string | null
): Promise<ErrorTrackingConfig> {
  const next: ErrorTrackingConfig = { dsn: dsn?.trim() || null };
  const lines = [
    "# Nakama error tracking",
    "# dsn = a Sentry-compatible DSN (Sentry, GlitchTip, Bugsink, self-hosted).",
    "# Empty or missing sends nothing. DO_NOT_TRACK=1 overrides this file.",
    ...(next.dsn ? [`dsn=${next.dsn}`] : []),
    "",
  ];

  await writeTextFile(getErrorTrackingConfigPath(), lines.join("\n"), {
    ensureDir: getErrorTrackingConfigDir(),
  });
  return next;
}

export async function isErrorTrackingEnabled(): Promise<boolean> {
  return resolveErrorTrackingDsn(await loadErrorTrackingConfig()) !== null;
}

export interface ErrorTrackingSettingsPublic {
  configured: boolean;
  dsnMasked: string | null;
}

/**
 * The raw DSN never leaves the server. It carries the operator's ingest key, and an
 * API response is the easiest place for it to end up in a log or a browser cache.
 */
export async function loadErrorTrackingSettingsPublic(): Promise<ErrorTrackingSettingsPublic> {
  const { dsn } = await loadErrorTrackingConfig();

  return {
    configured: Boolean(dsn),
    dsnMasked: dsn ? maskTrailingSecret(dsn) : null,
  };
}
