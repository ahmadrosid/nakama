export const SIDEBAR_COLLAPSED_KEY = "nakama-sidebar-collapsed";

export const SIDEBAR_RECENTS_COLLAPSED_KEY = "nakama-sidebar-recents-collapsed";

export const SIDEBAR_PINNED_COLLAPSED_KEY = "nakama-sidebar-pinned-collapsed";

export function getInitialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function getInitialRecentsCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_RECENTS_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function getInitialPinnedCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PINNED_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

const PINNED_PLUGINS_KEY = "nakama-sidebar-pinned-plugins";

const pinnedPluginListeners = new Set<() => void>();

/** Pins belong to one person in one organization, on this browser. */
export function pinnedPluginsStorageKey(userId: string, orgId: string): string {
  return `${PINNED_PLUGINS_KEY}:${userId}:${orgId}`;
}

export function readPinnedPluginIds(key: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(
      (key && localStorage.getItem(key)) || "[]"
    );

    return Array.isArray(parsed)
      ? // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
        parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function togglePinnedPlugin(key: string, pluginId: string): void {
  const pinned = readPinnedPluginIds(key);

  const next = pinned.includes(pluginId)
    ? pinned.filter((id) => id !== pluginId)
    : [...pinned, pluginId];

  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Ignore storage failures (private browsing, etc.)
  }

  for (const listener of pinnedPluginListeners) {
    listener();
  }
}

export function subscribePinnedPlugins(listener: () => void): () => void {
  pinnedPluginListeners.add(listener);

  return () => pinnedPluginListeners.delete(listener);
}
