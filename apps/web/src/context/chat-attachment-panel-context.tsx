import { cn } from "@nakama/ui/utils";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import { clampAttachmentPanelWidth } from "@/components/chat/attachment-panel-width";
import {
  type AttachmentPanelCloseInFlight,
  beginAttachmentPanelClose,
  type ChatAttachmentPanelConfig,
  ChatAttachmentPanelContext,
} from "@/context/chat-attachment-panel-context-shared";

const DEFAULT_PANEL_WIDTH = 448;

const PANEL_WIDTH_KEY = "nakama:attachment-panel-width";

/** One entry per chat, newest last, so the list cannot grow without end. */
const CHAT_PANELS_KEY = "nakama:chat-panels";

const MAX_REMEMBERED_CHATS = 50;

/** How long a saved panel waits for its card before it is dropped. */
const RESTORE_WAIT_MS = 1500;

/** The open panel of one chat: its card id, and the artifact it shows. */
interface RememberedPanel {
  id: string;
  restoreKey: string;
}

interface RememberedChatPanel extends RememberedPanel {
  chatId: string;
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be off or full; the panel still works for this visit.
  }
}

/** Saved panels, oldest first. Entries with a missing field are dropped. */
function readChatPanels(): RememberedChatPanel[] {
  try {
    // SAFETY: JSON.parse returns the values checked by the filter that follows.
    const parsed = JSON.parse(
      readStored(CHAT_PANELS_KEY) ?? "[]"
    ) as Partial<RememberedChatPanel>[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap(({ chatId, id, restoreKey }) =>
      chatId && id && restoreKey ? [{ chatId, id, restoreKey }] : []
    );
  } catch {
    return [];
  }
}

function readChatPanel(chatId: string): RememberedPanel | null {
  const entry = readChatPanels().find((panel) => panel.chatId === chatId);

  return entry ? { id: entry.id, restoreKey: entry.restoreKey } : null;
}

function writeChatPanel(chatId: string, panel: RememberedPanel | null): void {
  const rest = readChatPanels().filter((entry) => entry.chatId !== chatId);
  const next = panel ? [...rest, { chatId, ...panel }] : rest;

  writeStored(
    CHAT_PANELS_KEY,
    JSON.stringify(next.slice(-MAX_REMEMBERED_CHATS))
  );
}

function readSavedWidth(): number | null {
  const width = Number(readStored(PANEL_WIDTH_KEY));

  return Number.isFinite(width) && width > 0 ? width : null;
}

// The width the user last dragged the panel to; once set, it wins over each
// file's default width. Kept across reloads, and clamped to the screen on use.
let rememberedWidth: number | null = readSavedWidth();

const ENTER_SLIDE_MS = 200;

/**
 * The right side, flush with the chat: the open panel, with `below` under it.
 * No frame, so the panel header sits on the same line as the chat title bar.
 */
function ChatPanelColumn({
  below,
  fullscreen,
  panel,
  framed,
  width,
}: {
  below: ReactNode;
  fullscreen: boolean;
  panel: ReactNode;
  framed: boolean;
  width: number;
}) {
  if (!framed) {
    return (
      <>
        {panel}
        {below}
      </>
    );
  }

  // With no open panel, `below` keeps its own width and resize handle.
  const sized = Boolean(panel);

  return (
    <div
      className={cn(
        "flex min-h-0 shrink-0 flex-col max-sm:w-full max-sm:flex-1",
        "[&>aside+aside]:border-t [&>aside]:min-h-0 [&>aside]:flex-1 [&>aside]:overflow-hidden",
        sized &&
          "[&>aside+aside>[role=separator]]:hidden [&>aside+aside]:relative [&>aside]:w-full! [&>aside]:max-w-none",
        fullscreen && "flex-1"
      )}
      style={sized && !fullscreen ? { width } : undefined}
    >
      {panel}
      {below}
    </div>
  );
}

/** A fixed width wins over the saved one and turns off resizing. */
function panelSizing(
  config: ChatAttachmentPanelConfig | null,
  savedWidth: number
): { resizable: boolean; width: number } {
  if (config?.fixedWidth) {
    return { resizable: false, width: config.fixedWidth };
  }

  return {
    resizable: config?.resizable ?? !config?.fullscreen,
    width: savedWidth,
  };
}

/**
 * Saves the open panel of a chat and opens it again after a reload. Kept out
 * of the provider so the provider stays readable (react-doctor complexity).
 */
function useRememberedPanel(
  rememberId: string | undefined,
  config: ChatAttachmentPanelConfig | null
) {
  // The panel that was open when this chat was last left, read once.
  const pendingRestoreRef = useRef(
    rememberId ? readChatPanel(rememberId) : null
  );

  const restoreFallbackRef = useRef<(() => void) | null>(null);

  // Cards mount with the list. The exact card that was open wins; another
  // card for the same artifact (an earlier turn) opens only if it does not
  // show up in the same pass.
  const requestRestore = useCallback(
    (restoreKey: string, id: string, open: () => void) => {
      const pending = pendingRestoreRef.current;

      if (pending?.restoreKey !== restoreKey) {
        return () => undefined;
      }

      if (pending.id === id) {
        pendingRestoreRef.current = null;
        restoreFallbackRef.current = null;
        open();

        return () => undefined;
      }

      if (restoreFallbackRef.current) {
        return () => undefined;
      }

      restoreFallbackRef.current = open;

      const timeout = window.setTimeout(() => {
        if (pendingRestoreRef.current && restoreFallbackRef.current === open) {
          pendingRestoreRef.current = null;
          restoreFallbackRef.current = null;
          open();
        }
      }, 0);

      return () => {
        window.clearTimeout(timeout);

        if (restoreFallbackRef.current === open) {
          restoreFallbackRef.current = null;
        }
      };
    },
    []
  );

  // A card out of view (the list renders only what is on screen) or one that
  // is gone does not open the panel later: the saved panel is dropped.
  useEffect(() => {
    if (!(rememberId && pendingRestoreRef.current)) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (pendingRestoreRef.current) {
        pendingRestoreRef.current = null;
        writeChatPanel(rememberId, null);
      }
    }, RESTORE_WAIT_MS);

    return () => window.clearTimeout(timeout);
  }, [rememberId]);

  const openPanelId = config?.id ?? null;
  const openRestoreKey = config?.restoreKey ?? null;

  useEffect(() => {
    // Wait while a saved panel has not opened yet, so the first render does
    // not wipe it.
    if (!rememberId || (!openPanelId && pendingRestoreRef.current)) {
      return;
    }

    writeChatPanel(
      rememberId,
      openPanelId && openRestoreKey
        ? { id: openPanelId, restoreKey: openRestoreKey }
        : null
    );
  }, [rememberId, openPanelId, openRestoreKey]);

  return { pendingRestoreRef, requestRestore };
}

export function ChatAttachmentPanelProvider({
  below,
  children,
  presentation = "push",
  rememberId,
}: {
  /** A second panel. It sits under the open panel, or alone on the right. */
  below?: ReactNode;
  children: ReactNode;
  /** `push` shares row space (chat). `overlay` slides over content from the right. */
  presentation?: "push" | "overlay";
  /** Chat id: when set, the open panel opens again after a reload. */
  rememberId?: string;
}) {
  const [config, setConfig] = useState<ChatAttachmentPanelConfig | null>(null);

  const [width, setWidth] = useState(() =>
    rememberedWidth === null
      ? DEFAULT_PANEL_WIDTH
      : clampAttachmentPanelWidth(rememberedWidth)
  );

  // Only a drag the user finished is kept; fitting the panel to a smaller
  // window changes the width for now and saves nothing.
  const commitWidth = useCallback((next: number) => {
    rememberedWidth = next;
    setWidth(next);
    writeStored(PANEL_WIDTH_KEY, String(next));
  }, []);

  const { pendingRestoreRef, requestRestore } = useRememberedPanel(
    rememberId,
    config
  );

  const [enterSlide, setEnterSlide] = useState(false);
  const configRef = useRef<ChatAttachmentPanelConfig | null>(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const openId = config?.id ?? null;

  useEffect(() => {
    if (!openId || presentation !== "overlay") {
      setEnterSlide(false);

      return;
    }

    setEnterSlide(true);

    const timeout = window.setTimeout(
      () => setEnterSlide(false),
      ENTER_SLIDE_MS
    );

    return () => window.clearTimeout(timeout);
  }, [openId, presentation]);

  const hide = useCallback((id?: string) => {
    setConfig((current) => {
      if (!current) {
        return null;
      }

      if (id && current.id !== id) {
        return current;
      }

      return null;
    });
  }, []);

  const showGenerationRef = useRef(0);
  const closeInFlightRef = useRef<AttachmentPanelCloseInFlight>(null);

  const show = useCallback(
    (nextConfig: ChatAttachmentPanelConfig) => {
      const generation = ++showGenerationRef.current;
      // The user picked a panel, so the saved one no longer applies.
      pendingRestoreRef.current = null;

      const apply = () => {
        if (generation !== showGenerationRef.current) {
          return;
        }

        setConfig(nextConfig);

        if (nextConfig.defaultWidth != null && rememberedWidth === null) {
          setWidth(clampAttachmentPanelWidth(nextConfig.defaultWidth));
        }
      };

      const current = configRef.current;

      const priorClose =
        current && current.id !== nextConfig.id
          ? beginAttachmentPanelClose(current, closeInFlightRef)
          : null;

      if (priorClose) {
        void priorClose.finally(apply);

        return;
      }

      apply();
    },
    [pendingRestoreRef]
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<ChatAttachmentPanelConfig, "id">>) => {
      if (patch.defaultWidth != null && rememberedWidth === null) {
        setWidth(clampAttachmentPanelWidth(patch.defaultWidth));
      }

      setConfig((current) => {
        if (!current || current.id !== id) {
          return current;
        }

        return { ...current, ...patch };
      });
    },
    []
  );

  const handlePanelClose = useCallback(() => {
    // Drop any pending show() apply so a late prior-close cannot remount.
    showGenerationRef.current += 1;

    const priorClose = beginAttachmentPanelClose(
      configRef.current,
      closeInFlightRef
    );

    if (priorClose) {
      void priorClose.finally(() => {
        setConfig(null);
      });

      return;
    }

    setConfig(null);
  }, []);

  const value = useMemo(
    () => ({
      activeId: config?.id ?? null,
      hide,
      isFullscreen: config?.fullscreen ?? false,
      isOpen: config !== null,
      requestRestore,
      show,
      update,
    }),
    [config, show, update, hide, requestRestore]
  );

  const overlay = presentation === "overlay";
  const fullscreen = config?.fullscreen ?? false;
  const sizing = panelSizing(config, width);

  const panel = config ? (
    <>
      {overlay && !fullscreen ? (
        <button
          aria-label="Close artifact preview"
          className="fade-in-0 absolute inset-0 z-20 animate-in bg-background/50 transition-none duration-200"
          onClick={handlePanelClose}
          type="button"
        />
      ) : null}
      <AttachmentDetailPanel
        bodyClassName={config.bodyClassName}
        className={cn(
          overlay &&
            "absolute inset-y-0 right-0 z-30 h-full max-h-full overflow-hidden shadow-xl",
          overlay &&
            enterSlide &&
            "slide-in-from-right animate-in transition-none duration-200"
        )}
        fullscreen={fullscreen}
        headerActions={config.headerActions}
        leading={config.leading}
        onClose={handlePanelClose}
        onResizeEnd={commitWidth}
        onWidthChange={setWidth}
        resizable={sizing.resizable}
        subtitle={config.subtitle}
        title={config.title}
        typeLabel={config.typeLabel}
        width={sizing.width}
      >
        {config.content}
      </AttachmentDetailPanel>
    </>
  ) : null;

  return (
    <ChatAttachmentPanelContext.Provider value={value}>
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden",
          !overlay && "flex"
        )}
      >
        {overlay ? (
          <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden">
            {children}
          </div>
        ) : (
          children
        )}
        <ChatPanelColumn
          below={below}
          framed={Boolean((config || below) && !overlay)}
          fullscreen={fullscreen}
          panel={panel}
          width={sizing.width}
        />
      </div>
    </ChatAttachmentPanelContext.Provider>
  );
}
