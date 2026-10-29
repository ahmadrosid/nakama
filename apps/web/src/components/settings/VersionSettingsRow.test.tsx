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

  const upgradeState = spyOn(client, "getNakamaUpgrade").mockResolvedValue({
    available: false,
    rollbacks: [],
    status: null,
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    check.mockRestore();
    upgradeState.mockRestore();
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

test("with the updater running, Update sends the release and Restore asks first", async () => {
  const check = spyOn(client, "getNakamaVersion").mockResolvedValue({
    current: "0.4.59",
    latest: "0.4.60",
    releaseUrl: "https://github.com/ahmadrosid/nakama/releases/tag/v0.4.60",
    updateAvailable: true,
  });

  const upgradeState = spyOn(client, "getNakamaUpgrade").mockResolvedValue({
    available: true,
    rollbacks: [{ at: "2026-10-20T01:00:00Z", version: "0.4.58" }],
    status: {
      at: "2026-10-27T00:00:00Z",
      message: "0.4.60 did not become healthy. Restored 0.4.59 and its data.",
      state: "rolled_back",
      version: "0.4.59",
    },
  });

  const start = spyOn(client, "startNakamaUpgrade").mockResolvedValue({
    available: true,
    rollbacks: [],
    status: null,
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    check.mockRestore();
    upgradeState.mockRestore();
    start.mockRestore();
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

  expect(container.querySelector("pre")).toBeNull();
  expect(container.querySelector(".text-destructive")?.textContent).toContain(
    "Restored 0.4.59"
  );

  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Update to 0.4.60"
  );

  await act(async () => button?.click());
  await settle();

  expect(start.mock.calls[0]?.[0]).toBe("0.4.60");

  const restore = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Restore"
  );

  await act(async () => restore?.click());
  await settle();

  expect(start).toHaveBeenCalledTimes(1);

  const confirm = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === "Restore" && !container.contains(node)
  );

  await act(async () => confirm?.click());
  await settle();

  expect(start.mock.calls[1]).toEqual(["0.4.58", true]);
});

test("NAKAMA_DISABLE_UPDATE_CHECK hides the check, Update and Restore", async () => {
  const check = spyOn(client, "getNakamaVersion");
  const upgradeState = spyOn(client, "getNakamaUpgrade");

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    check.mockRestore();
    upgradeState.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  // SAFETY: VersionSettingsRow reads only user.isPlatformAdmin from this fixture.
  const auth = { user: { isPlatformAdmin: true } } as AuthContextValue;

  await act(async () => {
    root.render(
      <AuthContext.Provider value={auth}>
        <QueryClientProvider client={new QueryClient()}>
          <VersionSettingsRow updateCheckEnabled={false} version="0.4.59" />
        </QueryClientProvider>
      </AuthContext.Provider>
    );
  });
  await settle();

  expect(check).not.toHaveBeenCalled();
  expect(upgradeState).not.toHaveBeenCalled();
  expect(container.querySelectorAll("button")).toHaveLength(0);
});
