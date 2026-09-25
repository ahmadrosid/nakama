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
