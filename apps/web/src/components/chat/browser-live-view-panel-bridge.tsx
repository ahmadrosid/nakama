import { Button } from "@nakama/ui/button";
import { toast } from "@nakama/ui/toast";
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

type BrowserControl = "handoff" | "login" | "takeover";

/** Writes one audit event. A failed write is shown, never dropped. */
async function recordControl(
  sessionId: string,
  control: BrowserControl
): Promise<boolean> {
  try {
    await client.recordSessionBrowserControl(sessionId, control);

    return true;
  } catch {
    toast("Could not record who holds the browser");

    return false;
  }
}

/** Records in the audit log who holds the browser: the user or the agent. */
export function BrowserControlActions({
  loginPageRef,
  onStop,
  sessionIdRef,
}: {
  loginPageRef: { current: boolean };
  onStop: () => void;
  sessionIdRef: { current: string | null | undefined };
}) {
  // The chat the user took control in. The hand back goes to that chat, even
  // after the user opens a different one.
  const [heldSessionId, setHeldSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const heldRef = useRef<string | null>(null);

  const handBack = async () => {
    const held = heldRef.current;

    if (!held) {
      return;
    }

    if (loginPageRef.current && !(await recordControl(held, "login"))) {
      return;
    }

    if (await recordControl(held, "handoff")) {
      heldRef.current = null;
      setHeldSessionId(null);
    }
  };

  // Closing the panel ends the user's turn, so it hands back too.
  useEffect(
    () => () => {
      const held = heldRef.current;

      if (!held) {
        return;
      }

      heldRef.current = null;

      void (async () => {
        if (loginPageRef.current) {
          await recordControl(held, "login");
        }

        await recordControl(held, "handoff");
      })();
    },
    [loginPageRef]
  );

  return (
    <>
      <Button
        disabled={pending}
        onClick={async () => {
          setPending(true);

          try {
            if (heldRef.current) {
              await handBack();
            } else {
              const sessionId = sessionIdRef.current;

              if (sessionId && (await recordControl(sessionId, "takeover"))) {
                heldRef.current = sessionId;
                setHeldSessionId(sessionId);
              }
            }
          } finally {
            setPending(false);
          }
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {heldSessionId ? "Hand back to agent" : "Take control"}
      </Button>
      <Button
        disabled={pending}
        onClick={async () => {
          setPending(true);
          // The server refuses a hand back once the browser is gone.
          await handBack();
          heldRef.current = null;
          onStop();
        }}
        size="sm"
        type="button"
        variant="outline"
      >
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
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
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
              sessionIdRef={sessionIdRef}
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
