import { expect, test } from "bun:test";
import { NAKAMA_API_VERSION } from "@nakama/core/contract";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppContext, type AppContextValue } from "@/context/app-context-shared";
import { SetupGuard } from "./SetupGuard";

function renderGuard(
  path: string,
  userConfigured: boolean,
  providerConfigured: boolean
) {
  const context: AppContextValue = {
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
      userConfigured,
      version: "test",
    },
    loading: false,
    models: null,
  };

  return renderToString(
    <AppContext.Provider value={context}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<SetupGuard />}>
            <Route element={<div>Providers settings</div>} path="/settings" />
            <Route element={<div>Chat</div>} path="/chat" />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppContext.Provider>
  );
}

test("keeps provider settings accessible after deleting the last provider", () => {
  expect(renderGuard("/settings", true, false)).toContain("Providers settings");
});

test("allows the Finish destination without redirecting an existing user back to setup", () => {
  expect(renderGuard("/chat", true, false)).toContain("Chat");
});

test("allows chat with a configured account and provider", () => {
  expect(renderGuard("/chat", true, true)).toContain("Chat");
});

test.each([false, true])(
  "blocks app access before account setup (provider configured: %s)",
  (providerConfigured) => {
    expect(renderGuard("/chat", false, providerConfigured)).not.toContain(
      "Chat"
    );
  }
);
