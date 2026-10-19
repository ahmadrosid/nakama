import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { matchPath } from "react-router-dom";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import { useBtwChatStore } from "@/context/btw-chat-store";
import { ChatPageContent } from "@/pages/chat/chat-page-content";
import {
  type ChatHost,
  ChatHostContext,
  useChatPage,
} from "@/pages/chat/use-chat-page";

const BTW_PANEL_WIDTH = 448;

/** The side chat's own chat page, fed by its stored route and profile. */
function BtwChat({ question }: { question: string }) {
  const state = useChatPage();
  const consumeQuestion = useBtwChatStore((store) => store.consumeQuestion);
  const { activeProfile, composerDisabled, sendMessage } = state;
  const sendRef = useRef(sendMessage);
  const ready = Boolean(question && activeProfile && !composerDisabled);

  useLayoutEffect(() => {
    sendRef.current = sendMessage;
  });

  useEffect(() => {
    if (!ready) {
      return;
    }

    // The draft chat is set up in the same pass that makes it ready, so the
    // send waits for the next task, when that state has rendered.
    const timer = window.setTimeout(() => {
      consumeQuestion();
      void sendRef.current(question, []);
    });

    return () => window.clearTimeout(timer);
  }, [consumeQuestion, question, ready]);

  return <ChatPageContent {...state} />;
}

function BtwChatPanel() {
  const chat = useBtwChatStore((store) => store.chat);
  const close = useBtwChatStore((store) => store.close);
  const navigate = useBtwChatStore((store) => store.navigate);
  const setProfileId = useBtwChatStore((store) => store.setProfileId);
  const syncForOrg = useBtwChatStore((store) => store.syncForOrg);
  const [width, setWidth] = useState(BTW_PANEL_WIDTH);
  const path = chat?.path ?? "/chat";
  const [pathname = "/chat", query = ""] = path.split("?");

  const params = useMemo(
    () => matchPath("/chat/:profileId/:sessionId", pathname)?.params ?? {},
    [pathname]
  );

  const orgId = chat?.orgId ?? null;
  const profileId = chat?.profileId ?? null;

  const host = useMemo<ChatHost>(
    () => ({
      draftSessionId: "btw",
      location: { pathname, search: query ? `?${query}` : "" },
      navigate: (to) => navigate(to),
      params,
      profile: { orgId, profileId, setProfileId, syncForOrg },
    }),
    [
      navigate,
      orgId,
      params,
      pathname,
      profileId,
      query,
      setProfileId,
      syncForOrg,
    ]
  );

  if (!chat) {
    return null;
  }

  return (
    <AttachmentDetailPanel
      bodyClassName="flex flex-col overflow-hidden p-0"
      className="max-sm:absolute max-sm:inset-0 max-sm:z-30"
      onClose={close}
      onWidthChange={setWidth}
      title="Side chat"
      width={width}
    >
      <ChatHostContext.Provider value={host}>
        <BtwChat key={chat.id} question={chat.question} />
      </ChatHostContext.Provider>
    </AttachmentDetailPanel>
  );
}

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
