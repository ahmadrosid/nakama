import type { ProfileDetail } from "@nakama/core/contract";
import { ProfileOrgBooleanOverrideField } from "@/components/profiles/ProfileOrgBooleanOverrideField";

export function ProfileSkillsWriteApprovalField({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  return (
    <ProfileOrgBooleanOverrideField
      disabled={disabled}
      field="skillsWriteApproval"
      id="profile-skills-write-approval"
      label="Skill write approval"
      profile={profile}
      savedToast="Skill write approval setting saved."
    />
  );
}
