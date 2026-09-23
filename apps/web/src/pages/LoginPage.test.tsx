import { expect, test } from "bun:test";
import { NAKAMA_API_VERSION } from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppContext, type AppContextValue } from "@/context/app-context-shared";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ThemeContext } from "@/context/theme-context-shared";
import { LoginPage } from "./LoginPage";

async function renderLogin(providerConfigured: boolean) {
  const app: AppContextValue = {
    configureProvider: () =>
      Promise.reject(new Error("Unexpected provider write")),
    createProvider: () =>
      Promise.reject(new Error("Unexpected provider write")),
    error: null,
    health: {
      apiVersion: NAKAMA_API_VERSION,
      composioAvailable: false,
      composioConfigured: false,
      ok: true,
      providerConfigured,
      userConfigured: true,
      version: "test",
    },
    loading: false,
    models: null,
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () =>
    root.render(
      <ThemeContext.Provider
        value={{
          resolvedTheme: "light",
          setTheme: () => undefined,
          theme: "light",
          toggleTheme: () => undefined,
        }}
      >
        <AppContext.Provider value={app}>
          <AuthContext.Provider
            value={{ isAuthenticated: true } as AuthContextValue}
          >
            <MemoryRouter initialEntries={["/login"]}>
              <Routes>
                <Route element={<LoginPage />} path="/login" />
                <Route element={<div>Chat</div>} path="/chat" />
                <Route element={<div>Setup wizard</div>} path="/setup" />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </AppContext.Provider>
      </ThemeContext.Provider>
    )
  );

  const html = container.innerHTML;
  await act(async () => root.unmount());
  container.remove();
  return html;
}

test.each([false, true])(
  "signing in opens the app rather than the wizard (provider configured: %s)",
  async (providerConfigured) => {
    const html = await renderLogin(providerConfigured);
    expect(html).toContain("Chat");
    expect(html).not.toContain("Setup wizard");
  }
);
