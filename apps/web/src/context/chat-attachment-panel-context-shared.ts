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

/** In-flight prior-panel close so rapid show() swaps do not re-fire onClose. */
export type AttachmentPanelCloseInFlight = {
  id: string;
  promise: Promise<void>;
} | null;

/**
 * Starts (or reuses) `current.onClose`. Returns null when there is nothing to
 * await.
 */
export function beginAttachmentPanelClose(
  current: Pick<ChatAttachmentPanelConfig, "id" | "onClose"> | null,
  inFlight: { current: AttachmentPanelCloseInFlight }
): Promise<void> | null {
  if (!current) {
    return null;
  }

  if (inFlight.current?.id === current.id) {
    return inFlight.current.promise;
  }

  if (!current.onClose) {
    return null;
  }

  const id = current.id;
  const promise = Promise.resolve(current.onClose()).finally(() => {
    if (inFlight.current?.id === id) {
      inFlight.current = null;
    }
  });
  inFlight.current = { id, promise };
  return promise;
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
