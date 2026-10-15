import type { ProfileDetail } from "@nakama/core/contract";
import { Layers01Icon } from "hugeicons-react";
import { ProfileOrgBooleanOverrideField } from "@/components/profiles/ProfileOrgBooleanOverrideField";

export function ProfileSkillsCuratorConsolidateField({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  return (
    <ProfileOrgBooleanOverrideField
      description="Combine similar skills and keep them short and clear."
      disabled={disabled}
      field="skillsCuratorConsolidateEnabled"
      icon={<Layers01Icon size={18} />}
      id="profile-skills-curator-consolidate"
      label="Merge similar skills"
      profile={profile}
      savedToast="Saved."
    />
  );
}
