export interface SkillWriteApprovalSources {
  orgSkillsWriteApproval?: boolean | null;
  profileSkillsWriteApproval?: boolean | null;
}

/** Profile override wins when non-null; otherwise org default (false when unset). */
export function resolveSkillWriteApprovalRequired(
  sources: SkillWriteApprovalSources,
): boolean {
  if (sources.profileSkillsWriteApproval !== undefined && sources.profileSkillsWriteApproval !== null) {
    return sources.profileSkillsWriteApproval;
  }
  return sources.orgSkillsWriteApproval === true;
}
