import { useEffect, useState } from "react";
import {
  getInitialSidebarCollapsed,
  getInitialSystemNavCollapsed,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_SYSTEM_NAV_COLLAPSED_KEY,
} from "@/lib/sidebar";

export function useSidebarCollapsed() {
  const [collapsed, setCollapsedState] = useState(getInitialSidebarCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Ignore storage failures (private browsing, etc.)
    }
  }, [collapsed]);

  return {
    collapsed,
    toggle: () => setCollapsedState((current) => !current),
  };
}

export function useSystemNavCollapsed() {
  const [collapsed, setCollapsed] = useState(getInitialSystemNavCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_SYSTEM_NAV_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Ignore storage failures (private browsing, etc.)
    }
  }, [collapsed]);

  return {
    collapsed,
    toggle: () => setCollapsed((current) => !current),
  };
}
