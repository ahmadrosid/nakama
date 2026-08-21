import { resolveProfileOrgBooleanOverride } from "./profile-org-override";

export interface SkillPostTurnReviewSources {
  orgSkillsPostTurnReview?: boolean | null;
  profileSkillsPostTurnReview?: boolean | null;
}

/** Profile override wins when non-null; otherwise org default (false when unset). */
export function resolveSkillPostTurnReviewEnabled(
  sources: SkillPostTurnReviewSources
): boolean {
  return resolveProfileOrgBooleanOverride(
    sources.profileSkillsPostTurnReview,
    sources.orgSkillsPostTurnReview
  );
}
