import { ProfileSkillsSettingsSection } from "@/components/profiles/ProfileSkillsSettingsSection";
import { ProfileConfigAssignmentsSection } from "@/pages/profiles/profile-config-assignments-section";
import { ProfileConfigIdentitySection } from "@/pages/profiles/profile-config-identity-section";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

export function ProfileConfigTab({ state }: { state: ProfilesPageState }) {
  if (!state.detail) {
    return null;
  }

  return (
    <div
      aria-labelledby="profile-detail-tab-profile"
      id="profile-detail-panel-profile"
      role="tabpanel"
    >
      <ProfileConfigIdentitySection state={state} />
      <ProfileSkillsSettingsSection
        disabled={state.busy}
        profile={state.detail}
      />
      <ProfileConfigAssignmentsSection state={state} />
    </div>
  );
}
