import { Button } from "@nakama/ui/button";
import { toast } from "@nakama/ui/toast";
import { CheckmarkCircle01Icon, LockIcon } from "hugeicons-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { readRecord, readString } from "@/components/chat/web-search.shared";
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

/** The agent's last page, when that page asked for a password. */
function lastLoginPage(
  messages: ChatListItem[]
): { callId: string; host: string } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "tool" && message.tool === "browser_navigate") {
      const result = readRecord(message.toolResult);

      if (result?.loginForm !== true) {
        return null;
      }

      const callId = message.toolCallId ?? message.id;

      try {
        return { callId, host: new URL(readString(result.url) ?? "").hostname };
      } catch {
        return { callId, host: "The site" };
      }
    }
  }

  return null;
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

/**
 * Who holds the browser. The panel header and the chat card both show it, and
 * they have no common parent, so it lives outside React.
 */
interface BrowserControlState {
  /** The login page call the user last handed back from. */
  handedBackCallId: string | null;
  /** The chat the user took control in. The hand back goes to that chat. */
  heldSessionId: string | null;
  /** Goes up on each takeover, so a closed panel opens again. */
  openRequests: number;
  pending: boolean;
  running: boolean;
}

let controlState: BrowserControlState = {
  handedBackCallId: null,
  heldSessionId: null,
  openRequests: 0,
  pending: false,
  running: false,
};

const controlListeners = new Set<() => void>();

function setControlState(patch: Partial<BrowserControlState>) {
  controlState = { ...controlState, ...patch };

  for (const listener of controlListeners) {
    listener();
  }
}

function subscribeControl(listener: () => void) {
  controlListeners.add(listener);

  return () => {
    controlListeners.delete(listener);
  };
}

function useBrowserControl() {
  return useSyncExternalStore(subscribeControl, () => controlState);
}

async function takeControl(sessionId: string) {
  if (controlState.pending || controlState.heldSessionId) {
    return;
  }

  setControlState({ pending: true });

  try {
    if (await recordControl(sessionId, "takeover")) {
      setControlState({
        heldSessionId: sessionId,
        openRequests: controlState.openRequests + 1,
      });
    }
  } finally {
    setControlState({ pending: false });
  }
}

/** `loginCallId` names the login page the user had control on, if any. */
async function handBack(loginCallId: string | null) {
  const held = controlState.heldSessionId;

  if (controlState.pending || !held) {
    return;
  }

  setControlState({ pending: true });

  try {
    if (loginCallId && !(await recordControl(held, "login"))) {
      return;
    }

    if (await recordControl(held, "handoff")) {
      setControlState({ handedBackCallId: loginCallId, heldSessionId: null });
    }
  } finally {
    setControlState({ pending: false });
  }
}

/** Records in the audit log who holds the browser: the user or the agent. */
export function BrowserControlActions({
  loginPageRef,
  onStop,
  sessionIdRef,
}: {
  loginPageRef: { current: string | null };
  onStop: () => void;
  sessionIdRef: { current: string | null | undefined };
}) {
  const { heldSessionId, pending } = useBrowserControl();

  // Closing the panel ends the user's turn, so it hands back too.
  useEffect(
    () => () => {
      void handBack(loginPageRef.current);
    },
    [loginPageRef]
  );

  return (
    <>
      <Button
        disabled={pending}
        onClick={() => {
          if (heldSessionId) {
            void handBack(loginPageRef.current);
          } else if (sessionIdRef.current) {
            void takeControl(sessionIdRef.current);
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
          // The server refuses a hand back once the browser is gone.
          await handBack(loginPageRef.current);
          setControlState({ heldSessionId: null, running: false });
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

/** Asks the user in the chat to sign in when the agent stops at a login page. */
export function BrowserSignInCard({
  messages,
  sessionId,
}: {
  messages: ChatListItem[];
  sessionId?: string | null;
}) {
  const { handedBackCallId, heldSessionId, pending, running } =
    useBrowserControl();

  const page = lastLoginPage(messages);

  if (!(sessionId && page)) {
    return null;
  }

  const { callId, host } = page;

  if (handedBackCallId === callId && !heldSessionId) {
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
        <CheckmarkCircle01Icon aria-hidden className="size-4" />
        Handed back to the agent
      </p>
    );
  }

  const held = heldSessionId === sessionId;

  if (!(held || running)) {
    return null;
  }

  return (
    <div className="flex w-fit max-w-full items-center gap-3 rounded-xl bg-muted/40 p-3">
      <LockIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 font-medium text-foreground text-sm">
        {held
          ? `Sign in to ${host} in the Browser panel`
          : `${host} needs your sign-in`}
      </p>
      <Button
        className="min-h-10 shrink-0 rounded-lg"
        disabled={pending || (heldSessionId !== null && !held)}
        onClick={() => {
          void (held ? handBack(callId) : takeControl(sessionId));
        }}
        size="sm"
        type="button"
        variant={held ? "default" : "outline"}
      >
        {held ? "Hand back to agent" : "Take control"}
      </Button>
    </div>
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
  const loginPageRef = useRef<string | null>(null);

  useEffect(() => {
    loginPageRef.current = lastLoginPage(messages)?.callId ?? null;
  }, [messages]);
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  const activeIdRef = useRef(activeId);
  const dismissedUrlRef = useRef<string | null>(null);
  const { openRequests } = useBrowserControl();

  // A takeover from the chat card opens a panel the user closed before.
  useEffect(() => {
    dismissedUrlRef.current = null;
  }, [openRequests]);

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
        if (cancelled) {
          return;
        }

        setControlState({ running: Boolean(liveViewUrl) });

        if (
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
  }, [call, hide, openRequests, sessionId, show]);

  return null;
}
