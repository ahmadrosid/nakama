import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import { clampAttachmentPanelWidth } from "@/components/chat/attachment-panel-width";
import {
  ChatAttachmentPanelContext,
  type ChatAttachmentPanelConfig,
} from "@/context/chat-attachment-panel-context-shared";
import { cn } from "@/lib/utils";

const DEFAULT_PANEL_WIDTH = 448;
const ENTER_SLIDE_MS = 200;

export function ChatAttachmentPanelProvider({
  children,
  presentation = "push",
}: {
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
    const timeout = window.setTimeout(() => setEnterSlide(false), ENTER_SLIDE_MS);
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

  const show = useCallback((nextConfig: ChatAttachmentPanelConfig) => {
    const current = configRef.current;
    if (current && current.id !== nextConfig.id) {
      current.onClose?.();
    }
    setConfig(nextConfig);
    if (nextConfig.defaultWidth != null) {
      setWidth(clampAttachmentPanelWidth(nextConfig.defaultWidth));
    }
  }, []);

  const update = useCallback((id: string, patch: Partial<Omit<ChatAttachmentPanelConfig, "id">>) => {
    if (patch.defaultWidth != null) {
      setWidth(clampAttachmentPanelWidth(patch.defaultWidth));
    }

    setConfig((current) => {
      if (!current || current.id !== id) {
        return current;
      }
      return { ...current, ...patch };
    });
  }, []);

  const handlePanelClose = useCallback(() => {
    configRef.current?.onClose?.();
    setConfig(null);
  }, []);

  const value = useMemo(
    () => ({
      isOpen: config !== null,
      activeId: config?.id ?? null,
      isFullscreen: config?.fullscreen ?? false,
      show,
      update,
      hide,
    }),
    [config, show, update, hide],
  );

  const overlay = presentation === "overlay";
  const fullscreen = config?.fullscreen ?? false;

  return (
    <ChatAttachmentPanelContext.Provider value={value}>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-hidden",
          overlay ? "relative" : "flex",
        )}
      >
        {overlay ? (
          <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden">
            {children}
          </div>
        ) : (
          children
        )}
        {config ? (
          <>
            {overlay && !fullscreen ? (
              <button
                type="button"
                aria-label="Close artifact preview"
                className="absolute inset-0 z-20 bg-background/50 animate-in fade-in-0 duration-200 transition-none"
                onClick={handlePanelClose}
              />
            ) : null}
            <AttachmentDetailPanel
              title={config.title}
              subtitle={config.subtitle}
              headerActions={config.headerActions}
              bodyClassName={config.bodyClassName}
              resizable={config.resizable ?? !fullscreen}
              fullscreen={fullscreen}
              width={width}
              onWidthChange={setWidth}
              onClose={handlePanelClose}
              className={cn(
                overlay &&
                  "absolute inset-y-0 right-0 z-30 h-full max-h-full overflow-hidden shadow-xl",
                overlay &&
                  enterSlide &&
                  "animate-in slide-in-from-right duration-200 transition-none",
              )}
            >
              {config.content}
            </AttachmentDetailPanel>
          </>
        ) : null}
      </div>
    </ChatAttachmentPanelContext.Provider>
  );
}
