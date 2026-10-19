import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { matchPath } from "react-router-dom";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import { useBtwChatStore } from "@/context/btw-chat-store";
import { client } from "@/lib/client";
import { ChatPageContent } from "@/pages/chat/chat-page-content";
import {
  type ChatHost,
  ChatHostContext,
  useChatPage,
} from "@/pages/chat/use-chat-page";

const BTW_PANEL_WIDTH = 448;

let btwChatElement: HTMLDivElement | null = null;

/**
 * The side chat renders into this one element, and the panel moves the
 * element into place. ChatPage remounts on every route change, and a cognito
 * chat lives only in the page, so the chat itself must not remount with it.
 */
function getBtwChatElement(): HTMLDivElement {
  btwChatElement ??= Object.assign(document.createElement("div"), {
    className: "flex min-h-0 flex-1 flex-col",
  });

  return btwChatElement;
}

/** The side chat's own chat page, fed by its stored route and profile. */
function BtwChat({ question }: { question: string }) {
  const state = useChatPage();
  const consumeQuestion = useBtwChatStore((store) => store.consumeQuestion);

  const { activeProfile, cognito, composerDisabled, sendMessage, session } =
    state;

  const sendRef = useRef(sendMessage);
  const cognitoSessionRef = useRef<string | null>(null);
  const ready = Boolean(question && activeProfile && !composerDisabled);

  useLayoutEffect(() => {
    sendRef.current = sendMessage;
    cognitoSessionRef.current = cognito ? (session?.id ?? null) : null;
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

  // Closing the side chat ends a cognito session on the server too.
  useEffect(
    () => () => {
      const sessionId = cognitoSessionRef.current;

      if (sessionId) {
        void client
          .createChatSession(sessionId, "web")
          .purge()
          .catch(() => undefined);
      }
    },
    []
  );

  return <ChatPageContent {...state} cognitoLocked />;
}

/** Keeps the side chat mounted for as long as it is open, on any page. */
export function BtwChatHost() {
  const chat = useBtwChatStore((store) => store.chat);
  const navigate = useBtwChatStore((store) => store.navigate);
  const setProfileId = useBtwChatStore((store) => store.setProfileId);
  const syncForOrg = useBtwChatStore((store) => store.syncForOrg);
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
      cognito: true,
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

  return createPortal(
    <ChatHostContext.Provider value={host}>
      <BtwChat key={chat.id} question={chat.question} />
    </ChatHostContext.Provider>,
    getBtwChatElement()
  );
}

function BtwChatSlot() {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const element = getBtwChatElement();
    slot?.append(element);

    return () => {
      if (element.parentNode === slot) {
        element.remove();
      }
    };
  }, []);

  return <div className="flex min-h-0 flex-1 flex-col" ref={slotRef} />;
}

export function BtwChatPanel() {
  const close = useBtwChatStore((store) => store.close);
  const [width, setWidth] = useState(BTW_PANEL_WIDTH);

  return (
    <AttachmentDetailPanel
      bodyClassName="flex flex-col overflow-hidden p-0"
      className="max-sm:absolute max-sm:inset-0 max-sm:z-30"
      onClose={close}
      onWidthChange={setWidth}
      title="Side chat"
      width={width}
    >
      <BtwChatSlot />
    </AttachmentDetailPanel>
  );
}
