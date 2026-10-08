import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/context/use-auth";
import {
  getInitialSidebarCollapsed,
  pinnedPluginsStorageKey,
  readPinnedPluginIds,
  SIDEBAR_COLLAPSED_KEY,
  subscribePinnedPlugins,
  togglePinnedPlugin,
} from "@/lib/sidebar";

export function useLocalStorageFlag(key: string, getInitial: () => boolean) {
  const [collapsed, setCollapsed] = useState(getInitial);

  useEffect(() => {
    try {
      localStorage.setItem(key, String(collapsed));
    } catch {
      // Ignore storage failures (private browsing, etc.)
    }
  }, [collapsed, key]);

  return {
    collapsed,
    toggle: () => setCollapsed((current) => !current),
  };
}

export function useSidebarCollapsed() {
  return useLocalStorageFlag(SIDEBAR_COLLAPSED_KEY, getInitialSidebarCollapsed);
}

export function usePinnedPlugins() {
  const { user, activeOrg } = useAuth();
  const key =
    user && activeOrg ? pinnedPluginsStorageKey(user.id, activeOrg.id) : null;
  // The snapshot is a string so it stays equal between renders.
  const pinned = useSyncExternalStore(subscribePinnedPlugins, () =>
    readPinnedPluginIds(key).join("\n")
  );

  return {
    pinned: pinned ? pinned.split("\n") : [],
    toggle: (pluginId: string) => {
      if (key) {
        togglePinnedPlugin(key, pluginId);
      }
    },
  };
}
