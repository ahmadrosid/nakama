import { join } from "node:path";
import type { CrashReport } from "./crash-report";
import { readTextOrNull, writePrivateTextFile } from "./fs";
import { getUserConfigDir } from "./user-config";

/**
 * A crash that happens before the user has been asked would otherwise be lost, and the
 * first crash is usually the one worth having. Held on disk, unsent, until the answer
 * comes back. Discarded outright if the answer is no.
 */
export const MAX_PENDING_CRASH_REPORTS = 3;

export function getPendingCrashReportsPath(): string {
  return join(getUserConfigDir(), "crash-reports-pending.json");
}

export async function readPendingCrashReports(): Promise<CrashReport[]> {
  const raw = await readTextOrNull(getPendingCrashReportsPath());

  if (raw === null) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CrashReport[]) : [];
  } catch {
    return [];
  }
}

async function writePendingCrashReports(reports: CrashReport[]): Promise<void> {
  await writePrivateTextFile(
    getPendingCrashReportsPath(),
    `${JSON.stringify(reports, null, 2)}\n`,
    { ensureDir: getUserConfigDir() }
  );
}

/**
 * Deduplicates by fingerprint so a crash loop cannot fill the file with one bug and push
 * out the other two.
 */
export async function appendPendingCrashReport(
  report: CrashReport
): Promise<void> {
  const existing = await readPendingCrashReports();

  if (existing.some((entry) => entry.fingerprint === report.fingerprint)) {
    return;
  }

  const next = [...existing, report].slice(-MAX_PENDING_CRASH_REPORTS);
  await writePendingCrashReports(next);
}

export async function clearPendingCrashReports(): Promise<void> {
  await writePendingCrashReports([]);
}

export function getLastCrashReportPath(): string {
  return join(getUserConfigDir(), "crash-report-last.json");
}

/**
 * Keeps the most recent report, already scrubbed, so `nakama report --show` can print
 * exactly what would leave the machine. Without it every claim about what is sent has to
 * be taken on trust, which is the wrong way round for something that phones home.
 */
export async function recordLastCrashReport(
  report: CrashReport
): Promise<void> {
  await writePrivateTextFile(
    getLastCrashReportPath(),
    `${JSON.stringify(report, null, 2)}\n`,
    { ensureDir: getUserConfigDir() }
  );
}

export async function readLastCrashReport(): Promise<CrashReport | null> {
  const raw = await readTextOrNull(getLastCrashReportPath());

  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as CrashReport)
      : null;
  } catch {
    return null;
  }
}
