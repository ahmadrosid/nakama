import { ChatPageContent } from "@/pages/chat/chat-page-content";
import { useChatPage } from "@/pages/chat/use-chat-page";

export function ChatPage() {
  const state = useChatPage();
  return <ChatPageContent {...state} />;
}
