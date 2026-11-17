import { Button } from "@nakama/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { readRecord } from "@/components/chat/web-search.shared";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import type { ChatListItem } from "@/lib/chat-history";
import { client } from "@/lib/client";

const PANEL_ID = "session-browser";

/** Changes each time a browser_* tool call starts or finishes. */
function latestAgentBrowserCall(messages: ChatListItem[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "tool" && message.tool?.startsWith("browser_")) {
      return `${message.toolCallId}:${message.toolStatus ?? "done"}`;
    }
  }

  return null;
}

/** True when the agent's last page asked for a password. */
function lastPageAskedForLogin(messages: ChatListItem[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "tool" && message.tool === "browser_navigate") {
      return readRecord(message.toolResult)?.loginForm === true;
    }
  }

  return false;
}

/** Kernel saves the profile when the browser stops; a failed stop times out. */
function stopBrowser(sessionId: string) {
  void client.stopSessionBrowser(sessionId).catch(() => null);
}

/** Records in the audit log who holds the browser: the user or the agent. */
function BrowserControlActions({
  loginPageRef,
  onStop,
  sessionId,
}: {
  loginPageRef: { current: boolean };
  onStop: () => void;
  sessionId: string;
}) {
  const [userHasControl, setUserHasControl] = useState(false);

  const record = (control: "handoff" | "login" | "takeover") =>
    client.recordSessionBrowserControl(sessionId, control).catch(() => null);

  return (
    <>
      <Button
        onClick={() => {
          if (!userHasControl) {
            void record("takeover");
          } else if (loginPageRef.current) {
            void record("login").then(() => record("handoff"));
          } else {
            void record("handoff");
          }

          setUserHasControl(!userHasControl);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {userHasControl ? "Hand back to agent" : "Take control"}
      </Button>
      <Button onClick={onStop} size="sm" type="button" variant="outline">
        Stop browser
      </Button>
    </>
  );
}

/**
 * Shows the user's Kernel browser in the side panel after the agent
 * drives it, so the user can watch and sign in when a site asks for a login.
 */
export function BrowserLiveViewPanelBridge({
  messages,
  sessionId,
}: {
  messages: ChatListItem[];
  sessionId?: string | null;
}) {
  const { show, hide, activeId } = useChatAttachmentPanel();
  const call = useMemo(() => latestAgentBrowserCall(messages), [messages]);
  const loginPageRef = useRef(false);

  useEffect(() => {
    loginPageRef.current = lastPageAskedForLogin(messages);
  }, [messages]);
  const activeIdRef = useRef(activeId);
  const dismissedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!(sessionId && call)) {
      return;
    }

    let cancelled = false;

    void client
      .getSessionBrowser(sessionId)
      .then(({ liveViewUrl }) => {
        if (
          cancelled ||
          !liveViewUrl ||
          liveViewUrl === dismissedUrlRef.current ||
          activeIdRef.current === PANEL_ID
        ) {
          return;
        }

        show({
          bodyClassName: "flex flex-col overflow-hidden p-0",
          content: (
            <iframe
              allow="autoplay; clipboard-read; clipboard-write"
              className="min-h-0 w-full flex-1 border-0 bg-background"
              key={liveViewUrl}
              referrerPolicy="no-referrer"
              // oxlint-disable-next-line react-doctor/iframe-missing-sandbox -- The live view is Kernel's own origin and stays dark without same-origin; cross-origin, it cannot reach this page.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              src={liveViewUrl}
              title="Browser"
            />
          ),
          defaultWidth: 768,
          headerActions: (
            <BrowserControlActions
              loginPageRef={loginPageRef}
              onStop={() => {
                dismissedUrlRef.current = liveViewUrl;
                hide(PANEL_ID);
                stopBrowser(sessionId);
              }}
              sessionId={sessionId}
            />
          ),
          id: PANEL_ID,
          onClose: () => {
            dismissedUrlRef.current = liveViewUrl;
          },
          resizable: true,
          title: "Browser",
        });
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [call, hide, sessionId, show]);

  return null;
}
