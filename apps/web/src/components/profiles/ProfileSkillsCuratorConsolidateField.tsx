import type { ProfileDetail } from "@nakama/core/contract";
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
      disabled={disabled}
      field="skillsCuratorConsolidateEnabled"
      id="profile-skills-curator-consolidate"
      label="Skill consolidate"
      profile={profile}
      savedToast="Skill consolidate setting saved."
    />
  );
}
