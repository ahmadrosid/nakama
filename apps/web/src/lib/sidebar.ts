export const SIDEBAR_COLLAPSED_KEY = "nakama-sidebar-collapsed";
export const SIDEBAR_SYSTEM_NAV_COLLAPSED_KEY =
  "nakama-sidebar-system-nav-collapsed";

export function getInitialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function getInitialSystemNavCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_SYSTEM_NAV_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}
