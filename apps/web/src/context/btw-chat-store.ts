import { create } from "zustand";
import {
  pickKnownProfileId,
  resolveDefaultProfileId,
} from "@/lib/chat-history";

/**
 * The `/btw` side chat. It lives outside ChatPage because `/chat` and
 * `/chat/:profileId/:sessionId` are separate routes: the page remounts when
 * the main chat gets a session, and the side chat must survive that.
 */
interface BtwChat {
  /** Bumped on every `/btw`, so each one starts a fresh chat. */
  id: number;
  orgId: string | null;
  /** The side chat's own route, e.g. `/chat` or `/chat/:profileId/:sessionId`. */
  path: string;
  profileId: string | null;
  /** Sent once when the side chat is ready, then cleared. */
  question: string;
}

interface BtwChatState {
  chat: BtwChat | null;
  close: () => void;
  consumeQuestion: () => void;
  navigate: (path: string) => void;
  open: (input: {
    orgId: string | null;
    profileId: string | null;
    question: string;
  }) => void;
  setProfileId: (profileId: string) => void;
  syncForOrg: (input: {
    orgId: string | null;
    preferredProfileId?: string | null;
    profiles: ReadonlyArray<{ id: string }>;
  }) => string | null;
}

export const useBtwChatStore = create<BtwChatState>((set, get) => {
  const patch = (next: Partial<BtwChat>) =>
    set(({ chat }) => (chat ? { chat: { ...chat, ...next } } : {}));

  return {
    chat: null,
    close: () => set({ chat: null }),
    consumeQuestion: () => patch({ question: "" }),
    navigate: (path) => patch({ path }),
    open: ({ orgId, profileId, question }) =>
      set(({ chat }) => ({
        chat: {
          id: (chat?.id ?? 0) + 1,
          orgId,
          path: "/chat",
          profileId,
          question,
        },
      })),
    setProfileId: (profileId) => patch({ profileId }),
    syncForOrg: ({ orgId, profiles, preferredProfileId }) => {
      const current = get().chat;

      const resolved =
        pickKnownProfileId(
          profiles,
          preferredProfileId,
          current?.orgId === orgId ? current.profileId : null
        ) ?? resolveDefaultProfileId(profiles);

      if (current?.orgId !== orgId || current.profileId !== resolved) {
        patch({ orgId, profileId: resolved });
      }

      return resolved;
    },
  };
});
