import { useNavigate } from "react-router-dom";
import {
  buildChatPath,
  buildNewChatPath,
  MAX_URL_CHAT_DRAFT_LENGTH,
  type RequestedChatSession,
  storeChatDraft,
} from "@/lib/chat-history";
import {
  type PageId,
  pathForPage,
  skillDetailPath,
  toolPlaygroundPath,
} from "@/lib/navigation";

export function useAppNavigation() {
  const navigate = useNavigate();

  return {
    navigateToChat(session: RequestedChatSession) {
      navigate(buildChatPath(session.profileId, session.sessionId));
    },
    navigateToNewChat(profileId?: string | null, options?: { draft?: string }) {
      const draft = options?.draft?.trim();
      if (!draft) {
        navigate(buildNewChatPath(profileId));
        return;
      }

      const url = new URL(buildNewChatPath(profileId), "http://nakama.local");
      if (draft.length <= MAX_URL_CHAT_DRAFT_LENGTH) {
        url.searchParams.set("draft", draft);
      } else {
        url.searchParams.set("draftKey", storeChatDraft(draft));
      }

      navigate(`${url.pathname}?${url.searchParams.toString()}`);
    },
    navigateToPage(pageId: PageId) {
      navigate(pathForPage(pageId));
    },
    navigateToSkillDetail(skillId: string, options?: { profileId?: string }) {
      navigate(skillDetailPath(skillId, options));
    },
    navigateToToolPlayground(toolId: string) {
      navigate(toolPlaygroundPath(toolId));
    },
  };
}
