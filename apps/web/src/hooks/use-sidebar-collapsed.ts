import { useEffect, useState } from "react";
import {
  getInitialSidebarCollapsed,
  getInitialSystemNavCollapsed,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_SYSTEM_NAV_COLLAPSED_KEY,
} from "@/lib/sidebar";

function useLocalStorageFlag(key: string, getInitial: () => boolean) {
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

export function useSystemNavCollapsed() {
  return useLocalStorageFlag(
    SIDEBAR_SYSTEM_NAV_COLLAPSED_KEY,
    getInitialSystemNavCollapsed
  );
}
