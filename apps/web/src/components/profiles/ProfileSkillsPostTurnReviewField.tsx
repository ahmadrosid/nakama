import type { ProfileDetail } from "@nakama/core/contract";
import { ProfileOrgBooleanOverrideField } from "@/components/profiles/ProfileOrgBooleanOverrideField";

export function ProfileSkillsPostTurnReviewField({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  return (
    <ProfileOrgBooleanOverrideField
      disabled={disabled}
      field="skillsPostTurnReview"
      id="profile-skills-post-turn-review"
      label="Learn after a turn"
      profile={profile}
      savedToast="Learn after a turn setting saved."
    />
  );
}
