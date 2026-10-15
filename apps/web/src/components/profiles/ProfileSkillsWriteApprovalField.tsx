import type { ProfileDetail } from "@nakama/core/contract";
import { Shield01Icon } from "hugeicons-react";
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
      description="Check with you before this agent adds or changes a skill."
      disabled={disabled}
      field="skillsWriteApproval"
      icon={<Shield01Icon size={18} />}
      id="profile-skills-write-approval"
      label="Ask me before saving a skill"
      profile={profile}
      savedToast="Saved."
    />
  );
}
