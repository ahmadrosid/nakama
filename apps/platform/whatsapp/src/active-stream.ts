const activeByChat = new Map<string, AbortController>();

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function registerActiveStream(chatId: string): AbortSignal {
  activeByChat.get(chatId)?.abort();

  const controller = new AbortController();
  activeByChat.set(chatId, controller);
  return controller.signal;
}

export function clearActiveStream(chatId: string): void {
  activeByChat.delete(chatId);
}

export function stopActiveStream(chatId: string): boolean {
  const controller = activeByChat.get(chatId);

  if (!controller) {
    return false;
  }

  controller.abort();
  return true;
}

export function resetActiveStreamsForTests(): void {
  for (const controller of activeByChat.values()) {
    controller.abort();
  }

  activeByChat.clear();
}