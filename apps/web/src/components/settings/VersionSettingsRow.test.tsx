import { afterEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { VersionSettingsRow } from "./VersionSettingsRow";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

test("shows the newer release with its upgrade command and checks again on click", async () => {
  let latest = "0.4.60";

  const check = spyOn(client, "getNakamaVersion").mockImplementation(
    async () => ({
      current: "0.4.59",
      latest,
      releaseUrl: `https://github.com/ahmadrosid/nakama/releases/tag/v${latest}`,
      updateAvailable: latest !== "0.4.59",
    })
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    check.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  // SAFETY: VersionSettingsRow reads only user.isPlatformAdmin from this fixture.
  const auth = { user: { isPlatformAdmin: true } } as AuthContextValue;

  await act(async () => {
    root.render(
      <AuthContext.Provider value={auth}>
        <QueryClientProvider client={new QueryClient()}>
          <VersionSettingsRow updateCheckEnabled version="0.4.59" />
        </QueryClientProvider>
      </AuthContext.Provider>
    );
  });
  await settle();

  expect(container.querySelector("pre")?.textContent).toContain(
    "NAKAMA_VERSION=0.4.60"
  );
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    "https://github.com/ahmadrosid/nakama/releases/tag/v0.4.60"
  );

  latest = "0.4.59";

  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Check for updates"
  );

  await act(async () => button?.click());
  await settle();

  expect(check).toHaveBeenCalledTimes(2);
  expect(container.querySelector("pre")).toBeNull();
});
