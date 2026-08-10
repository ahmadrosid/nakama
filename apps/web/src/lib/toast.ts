import { useSyncExternalStore } from "react";

type Toast = { id: number; message: string };

let toasts: Toast[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function toast(message: string, durationMs = 4000) {
  const item = { id: ++nextId, message };
  toasts = [...toasts, item];
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    notify();
  }, durationMs);
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
