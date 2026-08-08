import { createContext, type ReactNode } from "react";

export interface ChatAttachmentPanelConfig {
  bodyClassName?: string;
  content: ReactNode;
  defaultWidth?: number;
  fullscreen?: boolean;
  headerActions?: ReactNode;
  id: string;
  onClose?: () => void;
  resizable?: boolean;
  subtitle?: string | null;
  title: string;
}

export interface ChatAttachmentPanelContextValue {
  activeId: string | null;
  hide: (id?: string) => void;
  isFullscreen: boolean;
  isOpen: boolean;
  show: (config: ChatAttachmentPanelConfig) => void;
  update: (
    id: string,
    patch: Partial<Omit<ChatAttachmentPanelConfig, "id">>
  ) => void;
}

export const ChatAttachmentPanelContext =
  createContext<ChatAttachmentPanelContextValue | null>(null);
