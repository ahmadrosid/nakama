import { NakamaApiError } from "@nakama/core";
import { canAccessSuperNakamaProfile } from "@nakama/core/profiles";
import { BUILTIN_TOOL_IDS } from "@nakama/core/tools/protected";
import type { DatabaseAdapter } from "@nakama/db";

/**
 * Caller role context used to gate access to admin-only profiles (e.g. Super
 * Nakama). `userId` is the person saving, whose Composio sign-ins runs use.
 */
export type ProfileAccess = Parameters<
  typeof canAccessSuperNakamaProfile
>[0] & { userId?: string | null };

/** Automation turns may use the email tool, so only an admin may write, run or read one on a profile that has it. */
export async function assertCanAutomateMailbox(
  db: DatabaseAdapter,
  profileId: string,
  access?: ProfileAccess
): Promise<void> {
  if (access?.isPlatformAdmin || access?.orgRole === "admin") {
    return;
  }

  const tools = await db.listToolsForProfile(profileId);

  if (tools.some((tool) => tool.id === BUILTIN_TOOL_IDS.email)) {
    throw new NakamaApiError(
      "Only org admins can automate an agent that has the email tool.",
      403
    );
  }
}

export async function resolveProfileId(
  db: DatabaseAdapter,
  orgId: string,
  profileId?: string,
  access?: ProfileAccess
): Promise<string> {
  const trimmed = profileId?.trim();

  if (trimmed) {
    const profile = await db.getProfileForOrg(trimmed, orgId);

    if (profile) {
      if (profile.isSuper && !canAccessSuperNakamaProfile(access ?? {})) {
        throw new NakamaApiError(
          "Super Nakama is only available to org admins.",
          403
        );
      }

      return profile.id;
    }

    throw new Error("Profile not found.");
  }

  const defaultProfile = await db.getDefaultProfileForOrg(orgId);

  if (!defaultProfile) {
    throw new Error("No default profile exists for this organization.");
  }

  return defaultProfile.id;
}
