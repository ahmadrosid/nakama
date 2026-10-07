import { useLocation, useNavigate } from "react-router-dom";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  isProfilesPath,
  resolveActiveProfileIdFromLocation,
} from "@/lib/chat-history";
import { PAGE_PATHS } from "@/lib/navigation";
import { resolveProfileSwitch } from "@/lib/profile-switch";

/** One agent switch for every picker, so the rail and Cmd+K agree per page. */
export function useSelectProfile() {
  const { data: profiles = [] } = useProfilesQuery();
  const { profileId: liveChatProfileId, setProfileId: setLiveChatProfileId } =
    useActiveChatProfile();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  const activeProfileId = resolveActiveProfileIdFromLocation({
    liveChatProfileId,
    pathname,
    profiles,
    profilesPath: PAGE_PATHS.profiles,
    search,
  });

  function selectProfile(profileId: string) {
    const next = resolveProfileSwitch({
      activeProfileId,
      pathname,
      profileId,
      search,
    });
    if (next.kind === "stay") {
      return;
    }

    setLiveChatProfileId(profileId);
    if (next.kind === "navigate") {
      navigate(next.to, { replace: next.replace });
    }
  }

  return {
    activeProfileId,
    onProfilesPage: isProfilesPath(pathname),
    profiles,
    selectProfile,
  };
}
