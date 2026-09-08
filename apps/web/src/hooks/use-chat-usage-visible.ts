import { useLocalStorageFlag } from "@/hooks/use-sidebar-collapsed";
import {
  CHAT_USAGE_VISIBLE_KEY,
  getInitialChatUsageVisible,
} from "@/lib/chat-usage";

/** Settings toggle: show tokens and cost under each assistant reply. */
export function useChatUsageVisible() {
  const { collapsed: visible, toggle } = useLocalStorageFlag(
    CHAT_USAGE_VISIBLE_KEY,
    getInitialChatUsageVisible
  );

  return { toggle, visible };
}
