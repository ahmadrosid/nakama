import { createContext, type ReactNode } from "react";

export interface ChatAttachmentPanelConfig {
  id: string;
  title: string;
  subtitle?: string | null;
  content: ReactNode;
  headerActions?: ReactNode;
  bodyClassName?: string;
  defaultWidth?: number;
  resizable?: boolean;
  fullscreen?: boolean;
  onClose?: () => void;
}

export interface ChatAttachmentPanelContextValue {
  isOpen: boolean;
  activeId: string | null;
  isFullscreen: boolean;
  show: (config: ChatAttachmentPanelConfig) => void;
  update: (id: string, patch: Partial<Omit<ChatAttachmentPanelConfig, "id">>) => void;
  hide: (id?: string) => void;
}

export const ChatAttachmentPanelContext =
  createContext<ChatAttachmentPanelContextValue | null>(null);
