/** Profile override wins when non-null; otherwise org default (false when unset). */
export function resolveProfileOrgBooleanOverride(
  profileValue: boolean | null | undefined,
  orgValue: boolean | null | undefined
): boolean {
  if (profileValue !== undefined && profileValue !== null) {
    return profileValue;
  }
  return orgValue === true;
}

export interface SkillWriteApprovalSources {
  orgSkillsWriteApproval?: boolean | null;
  profileSkillsWriteApproval?: boolean | null;
}

export function resolveSkillWriteApprovalRequired(
  sources: SkillWriteApprovalSources
): boolean {
  return resolveProfileOrgBooleanOverride(
    sources.profileSkillsWriteApproval,
    sources.orgSkillsWriteApproval
  );
}

export interface SkillPostTurnReviewSources {
  orgSkillsPostTurnReview?: boolean | null;
  profileSkillsPostTurnReview?: boolean | null;
}

export function resolveSkillPostTurnReviewEnabled(
  sources: SkillPostTurnReviewSources
): boolean {
  return resolveProfileOrgBooleanOverride(
    sources.profileSkillsPostTurnReview,
    sources.orgSkillsPostTurnReview
  );
}

export interface SkillCuratorConsolidateSources {
  orgSkillsCuratorConsolidateEnabled?: boolean | null;
  profileSkillsCuratorConsolidateEnabled?: boolean | null;
}

export function resolveSkillCuratorConsolidateEnabled(
  sources: SkillCuratorConsolidateSources
): boolean {
  return resolveProfileOrgBooleanOverride(
    sources.profileSkillsCuratorConsolidateEnabled,
    sources.orgSkillsCuratorConsolidateEnabled
  );
}
