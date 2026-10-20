import { useEffect } from "react";
import { BtwChatPanel } from "@/components/chat/btw-chat";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import { useBtwChatStore } from "@/context/btw-chat-store";
import { ChatPageContent } from "@/pages/chat/chat-page-content";
import { useChatPage } from "@/pages/chat/use-chat-page";

export function ChatPage() {
  const state = useChatPage();
  const openBtw = useBtwChatStore((store) => store.open);
  const btwOpen = useBtwChatStore((store) => store.chat !== null);

  useEffect(() => {
    const focusComposer = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"]'
          ))
      ) {
        return;
      }

      const composer = document.querySelector<HTMLTextAreaElement>(
        'textarea[name="message"]:not(:disabled):not([readonly])'
      );

      if (composer) {
        event.preventDefault();
        composer.focus();
      }
    };

    document.addEventListener("keydown", focusComposer);

    return () => document.removeEventListener("keydown", focusComposer);
  }, []);

  return (
    <ChatPageContent
      {...state}
      below={btwOpen ? <BtwChatPanel /> : null}
      onBtw={(question) =>
        openBtw({
          orgId: useActiveChatProfileStore.getState().orgId,
          profileId: state.profileId || null,
          question,
        })
      }
    />
  );
}
