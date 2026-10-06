import { expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CommandPalette } from "@/components/CommandPalette";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";

test("platform admin finds and opens an agent in another organization", async () => {
  const getContext = spyOn(
    window.HTMLCanvasElement.prototype,
    "getContext"
  ).mockImplementation(
    () =>
      ({
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: () => {},
      }) as never
  );
  const listProfiles = spyOn(client, "listProfiles").mockImplementation(
    async (orgId) =>
      ({
        profiles: [
          {
            hasAvatar: true,
            id: orgId === "org-b" ? "agent-b" : "agent-a",
            isSuper: false,
            model: "test-model",
            name: "Shared name",
            updatedAt: "2026-10-06T00:00:00Z",
          },
          {
            hasAvatar: false,
            id: orgId === "org-b" ? "super-b" : "super-a",
            isSuper: true,
            model: "test-model",
            name: orgId === "org-b" ? "Super Bot B" : "Super Bot A",
            updatedAt: "2026-10-06T00:00:00Z",
          },
          {
            hasAvatar: false,
            id: orgId === "org-b" ? "default-b" : "default-a",
            isDefault: true,
            isSuper: false,
            model: "test-model",
            name: orgId === "org-b" ? "Default Bot B" : "Default Bot A",
            updatedAt: "2026-10-06T00:00:00Z",
          },
        ],
      }) as never
  );
  const switchOrg = spyOn(client, "setActiveOrg").mockResolvedValue({
    activeOrgId: "org-b",
  } as never);
  const auth: AuthContextValue = {
    activeOrg: {
      createdAt: "2026-10-06T00:00:00Z",
      id: "org-a",
      name: "Org A",
      role: "admin",
      slug: "org-a",
      updatedAt: "2026-10-06T00:00:00Z",
    },
    archiveOrg: async () => {},
    createOrg: async () => {},
    isAuthenticated: true,
    isLoading: false,
    login: async () => ({ email: "admin@example.com", id: "admin" }),
    logout: async () => {},
    orgs: [],
    platformOrgs: [
      {
        createdAt: "2026-10-06T00:00:00Z",
        id: "org-a",
        name: "Org A",
        slug: "org-a",
        updatedAt: "2026-10-06T00:00:00Z",
      },
      {
        createdAt: "2026-10-06T00:00:00Z",
        id: "org-b",
        name: "Org B",
        slug: "org-b",
        updatedAt: "2026-10-06T00:00:00Z",
      },
    ],
    platformOrgsError: false,
    refreshPlatformOrgs: async () => {},
    refreshSession: async () => {},
    setup: async () => {},
    switchOrg: async (orgId) => {
      await switchOrg(orgId);
    },
    updateOrg: async () => {},
    user: { email: "admin@example.com", id: "admin", isPlatformAdmin: true },
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let path = "";
  function LocationProbe() {
    const location = useLocation();
    path = `${location.pathname}${location.search}`;
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <MemoryRouter initialEntries={["/chat"]}>
              <CommandPalette />
              <LocationProbe />
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true })
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("Org B");
    expect(document.body.textContent).toContain("Super Bot A");
    expect(document.body.textContent).not.toContain("Super Bot B");
    expect(document.body.textContent).toContain("Default Bot A");
    expect(document.body.textContent).not.toContain("Default Bot B");
    expect(listProfiles).toHaveBeenCalledWith("org-b");
    expect(document.querySelector('img[src*="agent-b"]')).toBeNull();

    const remote = [...document.querySelectorAll("[cmdk-item]")].find((item) =>
      item.textContent?.includes("Org B")
    );
    expect(remote).toBeTruthy();
    await act(async () => {
      (remote as HTMLElement).click();
    });
    expect(switchOrg).toHaveBeenCalledWith("org-b");
    expect(path).toBe("/chat?new=1&profile=agent-b");
    expect(useActiveChatProfileStore.getState()).toMatchObject({
      orgId: "org-b",
      profileId: "agent-b",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    listProfiles.mockRestore();
    switchOrg.mockRestore();
    getContext.mockRestore();
    useActiveChatProfileStore.setState({ orgId: null, profileId: null });
  }
});
