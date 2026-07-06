import { join } from "node:path";
import { getUserConfigDir } from "../user-config";
import { getSoulStatus, loadSoulStack } from "./load";
import type { LoadedSoulStack, SoulStatus } from "./types";

/** Per-profile soul stack: ~/.nakama/orgs/{orgId}/profiles/{profileId}/ */
export function getProfileSoulDir(orgId: string, profileId: string): string {
  return join(getUserConfigDir(), "orgs", orgId, "profiles", profileId);
}

export function getProfileArtifactsDir(orgId: string, profileId: string): string {
  return join(getProfileSoulDir(orgId, profileId), "artifacts");
}

export async function resolveSoulStackForProfile(
  orgId: string,
  profileId: string,
): Promise<LoadedSoulStack | null> {
  const stack = await loadSoulStack(getProfileSoulDir(orgId, profileId));
  return stack.loaded.length > 0 ? stack : null;
}

export async function getResolvedSoulStatus(
  orgId: string,
  profileId: string,
): Promise<SoulStatus> {
  return getSoulStatus(getProfileSoulDir(orgId, profileId));
}
