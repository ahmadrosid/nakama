import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { legacyArtifactProfileId } from "@/lib/files-page.shared";
import { ProfilesDialogs } from "@/pages/profiles/profiles-dialogs";
import { ProfilesPageLayout } from "@/pages/profiles/profiles-page-layout";
import { useProfilesPage } from "@/pages/profiles/use-profiles-page";

export function ProfilesPage() {
  const state = useProfilesPage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setProfileId } = useActiveChatProfile();
  const { data: profiles = [], isLoading: profilesLoading } =
    useProfilesQuery();
  const legacyArtifacts = searchParams.get("tab") === "artifacts";

  useEffect(() => {
    if (!legacyArtifacts || profilesLoading) {
      return;
    }

    const profileId = legacyArtifactProfileId(
      searchParams.toString(),
      profiles
    );
    if (profileId) {
      setProfileId(profileId);
    }
    navigate("/files", { replace: true });
  }, [
    legacyArtifacts,
    navigate,
    profiles,
    profilesLoading,
    searchParams,
    setProfileId,
  ]);

  if (legacyArtifacts) {
    return null;
  }

  return (
    <>
      <ProfilesPageLayout {...state} />
      <ProfilesDialogs {...state} />
    </>
  );
}
