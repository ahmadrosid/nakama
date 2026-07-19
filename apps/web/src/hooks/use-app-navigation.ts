import { useNavigate } from "react-router-dom";
import {
  buildChatPath,
  buildNewChatPath,
  type RequestedChatSession,
  MAX_URL_CHAT_DRAFT_LENGTH,
  storeChatDraft,
} from "@/lib/chat-history";
import { pathForPage, toolPlaygroundPath, type PageId } from "@/lib/navigation";

export function useAppNavigation() {
  const navigate = useNavigate();

  return {
    navigateToPage(pageId: PageId) {
      navigate(pathForPage(pageId));
    },
    navigateToChat(session: RequestedChatSession) {
      navigate(buildChatPath(session.profileId, session.sessionId));
    },
    navigateToToolPlayground(toolId: string) {
      navigate(toolPlaygroundPath(toolId));
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
  };
}
