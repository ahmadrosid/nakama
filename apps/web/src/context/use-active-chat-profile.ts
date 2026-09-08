import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";

export function useActiveChatProfile() {
  const orgId = useActiveChatProfileStore((state) => state.orgId);
  const profileId = useActiveChatProfileStore((state) => state.profileId);
  const setProfileId = useActiveChatProfileStore((state) => state.setProfileId);
  const syncForOrg = useActiveChatProfileStore((state) => state.syncForOrg);

  return {
    orgId,
    profileId,
    setProfileId,
    switchChatProfile: setProfileId,
    syncForOrg,
  };
}
