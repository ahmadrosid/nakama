import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SidebarUserMenu } from "@/components/SidebarUserMenu";
import { AppContext, type AppContextValue } from "@/context/app-context-shared";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ThemeContext } from "@/context/theme-context-shared";

async function openMenuWithVersion(version: string): Promise<string | null> {
  // SAFETY: The menu reads only user, activeOrg, logout and refreshSession.
  const auth: AuthContextValue = {
    activeOrg: null,
    logout: async () => {},
    refreshSession: async () => {},
    user: { email: "member@example.com", id: "member" },
  } as never;

  // SAFETY: The menu reads only health.version and health.updateCheckEnabled.
  const app: AppContextValue = {
    health: { updateCheckEnabled: false, version },
  } as never;

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AuthContext.Provider value={auth}>
              <AppContext.Provider value={app}>
                <ThemeContext.Provider
                  value={{
                    resolvedTheme: "light",
                    setTheme: () => {},
                    theme: "light",
                    toggleTheme: () => {},
                  }}
                >
                  <SidebarUserMenu />
                </ThemeContext.Provider>
              </AppContext.Provider>
            </AuthContext.Provider>
          </MemoryRouter>
        </QueryClientProvider>
      );
    });

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Account menu"]'
    );

    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const link = [...document.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("What's new")
    );

    return link?.getAttribute("href") ?? null;
  } finally {
    act(() => root.unmount());
    container.remove();
  }
}

test("What's new opens the release notes of the running version", async () => {
  expect(await openMenuWithVersion("0.4.69")).toBe(
    "https://github.com/ahmadrosid/nakama/releases/tag/v0.4.69"
  );
});

test("What's new opens the release list for a build with no release", async () => {
  expect(await openMenuWithVersion("0.4.69-dev")).toBe(
    "https://github.com/ahmadrosid/nakama/releases"
  );
});
