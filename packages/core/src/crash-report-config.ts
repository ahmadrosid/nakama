import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseIni, readTextOrNull, writePrivateTextFile } from "./fs";
import { getUserConfigDir } from "./user-config";

/**
 * "unset" means the install has never been asked. It is treated as denied everywhere,
 * so a missing consent prompt can only ever result in nothing being sent.
 */
export type CrashReportConsent = "granted" | "denied" | "unset";

export interface CrashReportConfig {
  consent: CrashReportConsent;
  installId: string | null;
}

const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSY = new Set(["0", "false", "off", "no"]);

export function getCrashReportConfigPath(): string {
  return join(getUserConfigDir(), "crash-reports.ini");
}

function parseConsent(value: string | undefined): CrashReportConsent {
  const trimmed = value?.trim().toLowerCase();

  if (trimmed === "granted" || trimmed === "denied") {
    return trimmed;
  }

  return "unset";
}

/**
 * Env beats the stored answer so an operator can settle it for a container that has no
 * terminal to prompt on. DO_NOT_TRACK is the cross-tool convention and wins over
 * everything, including a stored "granted".
 */
export function readCrashReportEnvOverride(
  env: Record<string, string | undefined> = process.env,
): CrashReportConsent | null {
  if (TRUTHY.has(env.DO_NOT_TRACK?.trim().toLowerCase() ?? "")) {
    return "denied";
  }

  const raw = env.NAKAMA_CRASH_REPORTS?.trim().toLowerCase();

  if (!raw) {
    return null;
  }

  if (TRUTHY.has(raw)) {
    return "granted";
  }

  if (FALSY.has(raw)) {
    return "denied";
  }

  return null;
}

export async function loadCrashReportConfig(): Promise<CrashReportConfig> {
  const raw = await readTextOrNull(getCrashReportConfigPath());

  if (raw === null) {
    return { consent: "unset", installId: null };
  }

  const values = parseIni(raw);

  return {
    consent: parseConsent(values.consent),
    installId: values.install_id?.trim() || null,
  };
}

export function resolveCrashReportConsent(
  file: CrashReportConfig,
  env: Record<string, string | undefined> = process.env,
): CrashReportConsent {
  return readCrashReportEnvOverride(env) ?? file.consent;
}

async function writeCrashReportConfig(config: CrashReportConfig): Promise<void> {
  const lines = [
    "# Nakama crash reports",
    "# consent=granted sends scrubbed crash reports so bugs get fixed.",
    "# consent=denied sends nothing. DO_NOT_TRACK=1 overrides this file.",
    `consent=${config.consent}`,
    ...(config.installId ? [`install_id=${config.installId}`] : []),
    "",
  ];

  await writePrivateTextFile(getCrashReportConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

/**
 * The install id is minted at the moment consent is granted, never before, and is not
 * derived from the hostname or machine id. An id that exists before the answer would
 * be a fingerprint the user never agreed to.
 */
export async function saveCrashReportConsent(
  consent: Exclude<CrashReportConsent, "unset">,
): Promise<CrashReportConfig> {
  const existing = await loadCrashReportConfig();
  const next: CrashReportConfig = {
    consent,
    installId: consent === "granted" ? (existing.installId ?? randomUUID()) : null,
  };

  await writeCrashReportConfig(next);
  resetCrashReportConsentCache();
  return next;
}

let cached: Promise<CrashReportConfig> | null = null;

export function resetCrashReportConsentCache(): void {
  cached = null;
}

export async function isCrashReportingAllowed(): Promise<boolean> {
  cached ??= loadCrashReportConfig();

  try {
    return resolveCrashReportConsent(await cached) === "granted";
  } catch {
    return false;
  }
}
