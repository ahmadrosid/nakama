import { afterEach, expect, spyOn, test } from "bun:test";
import { NakamaApiError } from "@nakama/core/api-error";
import { COMPOSIO_CUSTOM_AUTH_REQUIRED } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ComposioConnectionsCard } from "@/components/ComposioConnectionsCard";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { PAGE_PATHS } from "@/lib/navigation";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

// SAFETY: the card and its tabs read only activeOrg and user from the auth context.
const auth = {
  activeOrg: {
    createdAt: "",
    id: "org-a",
    name: "A",
    role: "admin",
    slug: "a",
    updatedAt: "",
  },
  user: { email: "admin@example.com", id: "admin", isPlatformAdmin: false },
} as AuthContextValue;

test("the Plugins tab stays reachable when Composio is not configured", async () => {
  const spies = [
    spyOn(client, "getComposioSettings").mockResolvedValue({
      apiKeyMasked: null,
      composioReachable: false,
      configured: false,
    }),
    spyOn(client, "listComposioToolkits").mockResolvedValue({
      catalog: [],
      catalogError: null,
      composioAvailable: false,
      composioReachable: false,
      configured: false,
      orgToolkits: [],
      userConnections: [],
    }),
    spyOn(client, "listProfiles").mockResolvedValue({ profiles: [] }),
  ];

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    for (const spy of spies) {
      spy.mockRestore();
    }

    await act(async () => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[PAGE_PATHS.composio]}>
          <AuthContext.Provider value={auth}>
            <ComposioConnectionsCard bordered embedded />
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const hrefs = () =>
    [...container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href")
    );

  for (let tries = 0; tries < 50; tries++) {
    if (hrefs().includes("/settings/preferences#composio")) {
      break;
    }

    await act(() => Bun.sleep(10));
  }

  expect(hrefs()).toContain(PAGE_PATHS["plugin-management"]);
  expect(hrefs()).toContain("/settings/preferences#composio");
});

async function openMissingAuthConfigDialog(role: "admin" | "member") {
  const spies = [
    spyOn(client, "getComposioSettings").mockResolvedValue({
      apiKeyMasked: null,
      composioReachable: true,
      configured: true,
    }),
    spyOn(client, "listComposioToolkits").mockResolvedValue({
      catalog: [
        {
          description: null,
          logoUrl: null,
          name: "Google Forms",
          slug: "googleforms",
        },
      ],
      catalogError: null,
      composioAvailable: true,
      composioReachable: true,
      configured: true,
      orgToolkits: [
        {
          cachedTools: [],
          displayName: "Google Forms",
          id: "tk-1",
          lastError: null,
          status: "enabled",
          toolkitSlug: "googleforms",
          updatedAt: "",
        },
      ],
      userConnections: [],
    }),
    spyOn(client, "listProfiles").mockResolvedValue({ profiles: [] }),
    spyOn(client, "connectComposioToolkit").mockRejectedValue(
      new NakamaApiError("No managed auth.", 422, undefined, undefined, {
        code: COMPOSIO_CUSTOM_AUTH_REQUIRED,
      })
    ),
  ];

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();

    for (const spy of spies) {
      spy.mockRestore();
    }
  });

  // SAFETY: the card and its tabs read only activeOrg and user from the auth context.
  const value = {
    ...auth,
    activeOrg: { ...auth.activeOrg, role },
  } as AuthContextValue;

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[PAGE_PATHS.composio]}>
          <AuthContext.Provider value={value}>
            <ComposioConnectionsCard bordered embedded />
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const findConnect = () =>
    [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Connect"
    );

  for (let tries = 0; tries < 50 && !findConnect(); tries++) {
    await act(() => Bun.sleep(10));
  }

  await act(async () => {
    findConnect()?.click();
  });

  const dialog = () => document.body.querySelector('[role="dialog"]');

  for (let tries = 0; tries < 50 && !dialog(); tries++) {
    await act(() => Bun.sleep(10));
  }

  expect(dialog()).not.toBeNull();

  return dialog();
}

test("only an admin gets setup steps for a missing auth config", async () => {
  const adminDialog = await openMissingAuthConfigDialog("admin");

  expect(adminDialog?.querySelector("ol")).not.toBeNull();

  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }

  const memberDialog = await openMissingAuthConfigDialog("member");

  expect(memberDialog?.querySelector("ol")).toBeNull();
  expect(
    [...document.body.querySelectorAll("a")].some((link) =>
      link.href.includes("custom-auth-configs")
    )
  ).toBe(false);
});
