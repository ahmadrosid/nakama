import { createContext, type ReactNode } from "react";

export interface ChatAttachmentPanelConfig {
  bodyClassName?: string;
  content: ReactNode;
  defaultWidth?: number;
  fullscreen?: boolean;
  headerActions?: ReactNode;
  id: string;
  leading?: ReactNode;
  onClose?: () => void | Promise<void>;
  resizable?: boolean;
  subtitle?: string | null;
  title: string;
  typeLabel?: string | null;
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
