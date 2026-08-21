import { isAbsolute, join } from "node:path";
import { getUserConfigDir } from "../user-config";
import { getSoulStatus, loadSoulStack } from "./load";
import type { LoadedSoulStack, SoulStatus } from "./types";

/** Reject path segments that would escape `~/.nakama/orgs/{id}/...`. */
export function assertConfigPathSegment(value: string, label: string): string {
  const trimmed = value.trim();

  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new Error(`Invalid ${label}.`);
  }

  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    throw new Error(`Invalid ${label}.`);
  }

  return trimmed;
}

/** Archive filenames are `YYYY-MM.md` — reject anything that could escape the archive dir. */
export function assertYearMonth(value: string): string {
  const trimmed = value.trim();

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) {
    throw new Error(`Invalid yearMonth (expected YYYY-MM): ${value}`);
  }

  return trimmed;
}

/** Per-profile soul stack: ~/.nakama/orgs/{orgId}/profiles/{profileId}/ */
export function getProfileSoulDir(orgId: string, profileId: string): string {
  return join(
    getUserConfigDir(),
    "orgs",
    assertConfigPathSegment(orgId, "orgId"),
    "profiles",
    assertConfigPathSegment(profileId, "profileId")
  );
}

export function getProfileArtifactsDir(
  orgId: string,
  profileId: string
): string {
  return join(getProfileSoulDir(orgId, profileId), "artifacts");
}

export function getArtifactSharesDir(orgId: string): string {
  return join(
    getUserConfigDir(),
    "orgs",
    assertConfigPathSegment(orgId, "orgId"),
    "artifact-shares"
  );
}

/** Org-level memory dir: ~/.nakama/orgs/{orgId}/ (sibling of the profile dirs). */
export function getOrgMemoryDir(
  orgId: string,
  configDir = getUserConfigDir()
): string {
  if (!isAbsolute(configDir)) {
    throw new Error(
      "configDir must be an absolute path; relative paths resolve against process.cwd() and break org isolation."
    );
  }
  return join(configDir, "orgs", assertConfigPathSegment(orgId, "orgId"));
}

/** Live org memory file: ~/.nakama/orgs/{orgId}/MEMORY.md */
export function getOrgMemoryFilePath(
  orgId: string,
  configDir?: string
): string {
  return join(getOrgMemoryDir(orgId, configDir), "MEMORY.md");
}

/** Org curator reports: ~/.nakama/orgs/{orgId}/logs/curator/ */
export function getOrgCuratorLogDir(
  orgId: string,
  configDir = getUserConfigDir()
): string {
  return join(getOrgMemoryDir(orgId, configDir), "logs", "curator");
}

/** Org memory archive dir: ~/.nakama/orgs/{orgId}/memory-archive/ */
export function getOrgMemoryArchiveDir(
  orgId: string,
  configDir?: string
): string {
  return join(getOrgMemoryDir(orgId, configDir), "memory-archive");
}

/** Org memory change history dir: ~/.nakama/orgs/{orgId}/memory-history/ */
export function getOrgMemoryHistoryDir(
  orgId: string,
  configDir?: string
): string {
  return join(getOrgMemoryDir(orgId, configDir), "memory-history");
}

/** Org memory archive file for a given year-month: ~/.nakama/orgs/{orgId}/memory-archive/YYYY-MM.md */
export function getOrgMemoryArchiveFilePath(
  orgId: string,
  yearMonth: string,
  configDir?: string
): string {
  return join(
    getOrgMemoryArchiveDir(orgId, configDir),
    `${assertYearMonth(yearMonth)}.md`
  );
}

export async function resolveSoulStackForProfile(
  orgId: string,
  profileId: string
): Promise<LoadedSoulStack | null> {
  const stack = await loadSoulStack(getProfileSoulDir(orgId, profileId));
  return stack.loaded.length > 0 ? stack : null;
}

export async function getResolvedSoulStatus(
  orgId: string,
  profileId: string
): Promise<SoulStatus> {
  return getSoulStatus(getProfileSoulDir(orgId, profileId));
}
