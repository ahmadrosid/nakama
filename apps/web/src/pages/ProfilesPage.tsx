import { ProfilesDialogs } from "@/pages/profiles/profiles-dialogs";
import { ProfilesPageLayout } from "@/pages/profiles/profiles-page-layout";
import { useProfilesPage } from "@/pages/profiles/use-profiles-page";

export function ProfilesPage() {
  const state = useProfilesPage();

  return (
    <>
      <ProfilesPageLayout {...state} />
      <ProfilesDialogs {...state} />
    </>
  );
}
