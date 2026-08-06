export interface SkillPostTurnReviewSources {
  orgSkillsPostTurnReview?: boolean | null;
  profileSkillsPostTurnReview?: boolean | null;
}

/** Profile override wins when non-null; otherwise org default (false when unset). */
export function resolveSkillPostTurnReviewEnabled(
  sources: SkillPostTurnReviewSources,
): boolean {
  if (
    sources.profileSkillsPostTurnReview !== undefined &&
    sources.profileSkillsPostTurnReview !== null
  ) {
    return sources.profileSkillsPostTurnReview;
  }
  return sources.orgSkillsPostTurnReview === true;
}
