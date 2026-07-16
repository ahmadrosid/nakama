import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";
import { ProfileConfigAssignmentsSection } from "@/pages/profiles/profile-config-assignments-section";
import { ProfileConfigIdentitySection } from "@/pages/profiles/profile-config-identity-section";

export function ProfileConfigTab({ state }: { state: ProfilesPageState }) {
  if (!state.detail) {
    return null;
  }

  return (
    <div
      id="profile-detail-panel-profile"
      role="tabpanel"
      aria-labelledby="profile-detail-tab-profile"
    >
      <ProfileConfigIdentitySection state={state} />
      <ProfileConfigAssignmentsSection state={state} />
    </div>
  );
}
