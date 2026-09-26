import { NakamaApiError, resolveProfileOrgBooleanOverride } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";

/**
 * Whether writes to a profile's skills are staged for admin review instead of
 * applying immediately. The org default is off, so a member's writes land
 * directly. Code loading also checks this switch, then verifies each code
 * file against an approved proposal so older writes are not auto-approved.
 *
 * Lives apart from the proposal service so `SkillsService` can read it while
 * deciding which skill tools to load, without a module cycle.
 */
export async function isSkillWriteApprovalRequired(
  database: DatabaseAdapter,
  orgId: string,
  profileId: string
): Promise<boolean> {
  const org = await database.getOrganizationById(orgId);
  if (!org) {
    throw new NakamaApiError("Organization not found.", 404);
  }
  const profile = await database.getProfileForOrg(profileId, orgId);
  if (!profile) {
    throw new NakamaApiError("Profile not found.", 404);
  }
  return resolveProfileOrgBooleanOverride(
    profile.skillsWriteApproval ?? null,
    org.skillsWriteApproval ?? false
  );
}
