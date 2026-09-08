import { create } from "zustand";
import {
  pickKnownProfileId,
  readStoredActiveChatProfileId,
  resolveDefaultProfileId,
  writeStoredActiveChatProfileId,
} from "@/lib/chat-history";

export interface ActiveChatProfileState {
  orgId: string | null;
  profileId: string | null;
  setProfileId: (profileId: string) => void;
  syncForOrg: (input: {
    orgId: string | null;
    preferredProfileId?: string | null;
    profiles: ReadonlyArray<{ id: string }>;
  }) => string | null;
}

export const useActiveChatProfileStore = create<ActiveChatProfileState>(
  (set, get) => ({
    orgId: null,
    profileId: readStoredActiveChatProfileId(),
    setProfileId: (profileId) => {
      writeStoredActiveChatProfileId(profileId, get().orgId);
      set({ profileId });
    },
    syncForOrg: ({ orgId, profiles, preferredProfileId }) => {
      const current = get();
      const orgChanged = current.orgId !== orgId;
      const stored = readStoredActiveChatProfileId(orgId);
      const resolved =
        pickKnownProfileId(
          profiles,
          preferredProfileId,
          orgChanged ? stored : current.profileId,
          stored
        ) ?? resolveDefaultProfileId(profiles);

      if (resolved) {
        writeStoredActiveChatProfileId(resolved, orgId);
      }

      if (current.orgId === orgId && current.profileId === resolved) {
        return resolved;
      }

      set({ orgId, profileId: resolved });
      return resolved;
    },
  })
);
