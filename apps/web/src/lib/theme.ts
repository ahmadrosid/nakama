export type Theme = "light" | "dark" | "system";

export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "nakama-theme";

export function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return getSystemTheme();
  }

  return theme;
}

export function getInitialTheme(): Theme {
  return getStoredTheme() ?? "system";
}

export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}
