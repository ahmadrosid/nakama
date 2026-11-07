import { useSyncExternalStore } from "react";

type ToastAction = { label: string; onClick: () => void };

type Toast = { action?: ToastAction; id: number; message: string };

let toasts: Toast[] = [];

let nextId = 0;

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

/** An action, such as Undo, closes the toast when pressed. */
export function toast(
  message: string,
  durationMs = 4000,
  action?: ToastAction
) {
  const item: Toast = {
    action: action && {
      label: action.label,
      onClick: () => {
        dismiss(item.id);
        action.onClick();
      },
    },
    id: ++nextId,
    message,
  };

  toasts = [...toasts, item];
  notify();
  setTimeout(() => dismiss(item.id), durationMs);
}

export function useToasts() {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);

      return () => listeners.delete(onStoreChange);
    },
    () => toasts,
    () => toasts
  );
}
