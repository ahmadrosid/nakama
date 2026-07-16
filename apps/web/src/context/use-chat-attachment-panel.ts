import { useContext } from "react";
import {
  ChatAttachmentPanelContext,
  type ChatAttachmentPanelContextValue,
} from "@/context/chat-attachment-panel-context-shared";

export function useChatAttachmentPanel(): ChatAttachmentPanelContextValue {
  const context = useContext(ChatAttachmentPanelContext);

  if (!context) {
    throw new Error("useChatAttachmentPanel must be used within ChatAttachmentPanelProvider");
  }

  return context;
}

export function useOptionalChatAttachmentPanel(): ChatAttachmentPanelContextValue | null {
  return useContext(ChatAttachmentPanelContext);
}
