export const SIDEBAR_COLLAPSED_KEY = "nakama-sidebar-collapsed";

export function getInitialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}
