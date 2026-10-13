import type { ProfileDetail } from "@nakama/core/contract";
import { BookOpen01Icon } from "hugeicons-react";
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
      description="After each reply, look for ways to get better at its skills."
      disabled={disabled}
      field="skillsPostTurnReview"
      icon={<BookOpen01Icon size={18} />}
      id="profile-skills-post-turn-review"
      label="Learn from chats"
      profile={profile}
      savedToast="Saved."
    />
  );
}
