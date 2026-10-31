import { afterEach, expect, spyOn, test } from "bun:test";
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

test("a search in the URL opens the list already searched", async () => {
  const toolkit = (slug: string, name: string) => ({
    description: null,
    logoUrl: null,
    name,
    slug,
  });

  const spies = [
    spyOn(client, "getComposioSettings").mockResolvedValue({
      apiKeyMasked: "ak_***",
      composioReachable: true,
      configured: true,
    }),
    spyOn(client, "listComposioToolkits").mockResolvedValue({
      catalog: [toolkit("canva", "Canva"), toolkit("notion", "Notion")],
      catalogError: null,
      composioAvailable: true,
      composioReachable: true,
      configured: true,
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
        <MemoryRouter initialEntries={[`${PAGE_PATHS.composio}?search=canva`]}>
          <AuthContext.Provider value={auth}>
            <ComposioConnectionsCard bordered embedded />
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const searchBox = () =>
    container.querySelector<HTMLInputElement>('input[type="search"]');

  for (let tries = 0; tries < 50 && !searchBox(); tries++) {
    await act(() => Bun.sleep(10));
  }

  expect(searchBox()?.value).toBe("canva");
  expect(container.textContent).toContain("Canva");
  expect(container.textContent).not.toContain("Notion");
});
