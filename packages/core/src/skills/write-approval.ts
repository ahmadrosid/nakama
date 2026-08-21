import { resolveProfileOrgBooleanOverride } from "./profile-org-override";

export interface SkillWriteApprovalSources {
  orgSkillsWriteApproval?: boolean | null;
  profileSkillsWriteApproval?: boolean | null;
}

/** Profile override wins when non-null; otherwise org default (false when unset). */
export function resolveSkillWriteApprovalRequired(
  sources: SkillWriteApprovalSources
): boolean {
  return resolveProfileOrgBooleanOverride(
    sources.profileSkillsWriteApproval,
    sources.orgSkillsWriteApproval
  );
}
