import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import {
  ChatAttachmentPanelContext,
  type ChatAttachmentPanelConfig,
} from "@/context/chat-attachment-panel-context-shared";

const DEFAULT_PANEL_WIDTH = 448;

export function ChatAttachmentPanelProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ChatAttachmentPanelConfig | null>(null);
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);

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
    setConfig((current) => {
      if (current && current.id !== nextConfig.id) {
        current.onClose?.();
      }
      return nextConfig;
    });
    if (nextConfig.defaultWidth != null) {
      setWidth(nextConfig.defaultWidth);
    }
  }, []);

  const update = useCallback((id: string, patch: Partial<Omit<ChatAttachmentPanelConfig, "id">>) => {
    setConfig((current) => {
      if (!current || current.id !== id) {
        return current;
      }
      return { ...current, ...patch };
    });
  }, []);

  const handlePanelClose = useCallback(() => {
    setConfig((current) => {
      current?.onClose?.();
      return null;
    });
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

  return (
    <ChatAttachmentPanelContext.Provider value={value}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {children}
        {config ? (
          <AttachmentDetailPanel
            title={config.title}
            headerActions={config.headerActions}
            bodyClassName={config.bodyClassName}
            resizable={config.resizable ?? !config.fullscreen}
            fullscreen={config.fullscreen ?? false}
            width={width}
            onWidthChange={setWidth}
            onClose={handlePanelClose}
          >
            {config.content}
          </AttachmentDetailPanel>
        ) : null}
      </div>
    </ChatAttachmentPanelContext.Provider>
  );
}
