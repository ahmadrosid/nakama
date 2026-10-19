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

const ENTER_SLIDE_MS = 200;

/** The right side: the open panel, with `below` under it when both are open. */
function ChatPanelColumn({
  below,
  fullscreen,
  panel,
  stacked,
  width,
}: {
  below: ReactNode;
  fullscreen: boolean;
  panel: ReactNode;
  stacked: boolean;
  width: number;
}) {
  if (!stacked) {
    return (
      <>
        {panel}
        {below}
      </>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 shrink-0 flex-col gap-1 p-1 max-sm:w-full max-sm:flex-1",
        "[&>aside+aside>[role=separator]]:hidden [&>aside+aside]:relative [&>aside]:min-h-0 [&>aside]:w-full! [&>aside]:max-w-none [&>aside]:flex-1 [&>aside]:overflow-hidden [&>aside]:rounded-lg [&>aside]:border",
        fullscreen && "flex-1"
      )}
      style={fullscreen ? undefined : { width }}
    >
      {panel}
      {below}
    </div>
  );
}

export function ChatAttachmentPanelProvider({
  below,
  children,
  presentation = "push",
}: {
  /** A second panel. It sits under the open panel, or alone on the right. */
  below?: ReactNode;
  children: ReactNode;
  /** `push` shares row space (chat). `overlay` slides over content from the right. */
  presentation?: "push" | "overlay";
}) {
  const [config, setConfig] = useState<ChatAttachmentPanelConfig | null>(null);
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
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

  const show = useCallback((nextConfig: ChatAttachmentPanelConfig) => {
    const generation = ++showGenerationRef.current;

    const apply = () => {
      if (generation !== showGenerationRef.current) {
        return;
      }

      setConfig(nextConfig);

      if (nextConfig.defaultWidth != null) {
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
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<Omit<ChatAttachmentPanelConfig, "id">>) => {
      if (patch.defaultWidth != null) {
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
      show,
      update,
    }),
    [config, show, update, hide]
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
        onWidthChange={setWidth}
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
          fullscreen={fullscreen}
          panel={panel}
          stacked={Boolean(below && config && !overlay)}
          width={width}
        />
      </div>
    </ChatAttachmentPanelContext.Provider>
  );
}
