export interface RouteErrorState {
  error?: string;
  failed: boolean;
  resetKey?: string;
}

const ROUTE_RELOAD_COOLDOWN_MS = 30_000;

export function shouldReloadAfterRouteError(
  error: string | undefined,
  storage: Pick<Storage, "getItem" | "setItem">,
  now = Date.now()
): boolean {
  const message = error?.toLowerCase() ?? "";
  const isStaleChunk =
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("loading chunk") ||
    message.includes("chunkloaderror");
  if (!isStaleChunk) {
    return false;
  }

  const key = "nakama:route-reload-at";
  const stored = storage.getItem(key);
  const previous = stored === null ? null : Number(stored);
  if (
    previous !== null &&
    Number.isFinite(previous) &&
    now - previous < ROUTE_RELOAD_COOLDOWN_MS
  ) {
    return false;
  }

  storage.setItem(key, String(now));
  return true;
}

export function routeErrorStateFromResetKey(
  resetKey: string | undefined,
  state: RouteErrorState
): Partial<RouteErrorState> | null {
  if (resetKey === state.resetKey) {
    return null;
  }

  return { error: undefined, failed: false, resetKey };
}
