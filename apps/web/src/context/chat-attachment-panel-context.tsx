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

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Storage can be off or full; the panel still works for this visit.
  }
}

function readRememberedWidth(): number | null {
  const width = Number(readStored(PANEL_WIDTH_KEY));

  return Number.isFinite(width) && width > 0
    ? clampAttachmentPanelWidth(width)
    : null;
}

// The width the user last gave the panel; once set, it wins over each file's
// default width. Kept across reloads.
let rememberedWidth: number | null = readRememberedWidth();

const ENTER_SLIDE_MS = 200;

/** The right side as cards: the open panel, with `below` under it. */
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
        "flex min-h-0 shrink-0 flex-col gap-1.5 p-1.5 max-sm:w-full max-sm:flex-1",
        "[&>aside]:min-h-0 [&>aside]:flex-1 [&>aside]:overflow-hidden [&>aside]:rounded-lg [&>aside]:border [&>aside]:shadow-xs",
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

/** Saves the open panel under `rememberKey` and offers it once after a reload. */
function useRememberedPanel(
  rememberKey: string | undefined,
  config: ChatAttachmentPanelConfig | null
) {
  // Read once on mount: the panel that was open when this chat was last left.
  const pendingRestoreRef = useRef(
    rememberKey ? readStored(rememberKey) : null
  );

  const claimRestore = useCallback((restoreKey: string) => {
    if (pendingRestoreRef.current !== restoreKey) {
      return false;
    }

    pendingRestoreRef.current = null;

    return true;
  }, []);

  const savedRestoreKey = config?.restoreKey ?? null;
  const panelOpen = config !== null;

  useEffect(() => {
    // Wait while a saved panel has not opened yet, so the first render does
    // not wipe it.
    if (!rememberKey || (!panelOpen && pendingRestoreRef.current)) {
      return;
    }

    writeStored(rememberKey, savedRestoreKey);
  }, [rememberKey, panelOpen, savedRestoreKey]);

  return { claimRestore, pendingRestoreRef };
}

export function ChatAttachmentPanelProvider({
  below,
  children,
  presentation = "push",
  rememberKey,
}: {
  /** A second panel. It sits under the open panel, or alone on the right. */
  below?: ReactNode;
  children: ReactNode;
  /** `push` shares row space (chat). `overlay` slides over content from the right. */
  presentation?: "push" | "overlay";
  /** Storage key: when set, the open panel opens again after a reload. */
  rememberKey?: string;
}) {
  const [config, setConfig] = useState<ChatAttachmentPanelConfig | null>(null);
  const [width, setWidth] = useState(rememberedWidth ?? DEFAULT_PANEL_WIDTH);

  const resize = useCallback((next: number) => {
    rememberedWidth = next;
    setWidth(next);
    writeStored(PANEL_WIDTH_KEY, String(next));
  }, []);

  const { claimRestore, pendingRestoreRef } = useRememberedPanel(
    rememberKey,
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
      claimRestore,
      hide,
      isFullscreen: config?.fullscreen ?? false,
      isOpen: config !== null,
      show,
      update,
    }),
    [config, show, update, hide, claimRestore]
  );

  const overlay = presentation === "overlay";
  const fullscreen = config?.fullscreen ?? false;

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
        onWidthChange={resize}
        resizable={config.resizable ?? !fullscreen}
        subtitle={config.subtitle}
        title={config.title}
        typeLabel={config.typeLabel}
        width={width}
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
          width={width}
        />
      </div>
    </ChatAttachmentPanelContext.Provider>
  );
}
