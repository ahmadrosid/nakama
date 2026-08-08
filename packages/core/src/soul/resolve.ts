import { join } from "node:path";
import { getUserConfigDir } from "../user-config";
import { getSoulStatus, loadSoulStack } from "./load";
import type { LoadedSoulStack, SoulStatus } from "./types";

/** Per-profile soul stack: ~/.nakama/orgs/{orgId}/profiles/{profileId}/ */
export function getProfileSoulDir(orgId: string, profileId: string): string {
  return join(getUserConfigDir(), "orgs", orgId, "profiles", profileId);
}

export function getProfileArtifactsDir(
  orgId: string,
  profileId: string
): string {
  return join(getProfileSoulDir(orgId, profileId), "artifacts");
}

export function getArtifactSharesDir(orgId: string): string {
  return join(getUserConfigDir(), "orgs", orgId, "artifact-shares");
}

/** Org-level memory dir: ~/.nakama/orgs/{orgId}/ (sibling of the profile dirs). */
export function getOrgMemoryDir(
  orgId: string,
  configDir = getUserConfigDir()
): string {
  return join(configDir, "orgs", orgId);
}

/** Live org memory file: ~/.nakama/orgs/{orgId}/MEMORY.md */
export function getOrgMemoryFilePath(
  orgId: string,
  configDir?: string
): string {
  return join(getOrgMemoryDir(orgId, configDir), "MEMORY.md");
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
  return join(getOrgMemoryArchiveDir(orgId, configDir), `${yearMonth}.md`);
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
