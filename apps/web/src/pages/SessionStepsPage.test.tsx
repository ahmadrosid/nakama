import { afterEach, expect, spyOn, test } from "bun:test";
import type { PlatformSessionStepsResponse } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PlatformAdminGuard } from "@/components/PlatformAdminGuard";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { SessionStepsPage } from "@/pages/SessionStepsPage";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function spySteps(response: PlatformSessionStepsResponse) {
  const spy = spyOn(client, "getPlatformSessionSteps").mockResolvedValue(
    response
  );

  cleanups.push(() => spy.mockRestore());

  return spy;
}

function Location() {
  const location = useLocation();

  return (
    <output data-location>{`${location.pathname}${location.search}`}</output>
  );
}

function auth(isPlatformAdmin: boolean): AuthContextValue {
  return {
    activeOrg: {
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "org_active",
      name: "Active",
      role: "admin",
      slug: "active",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    archiveOrg: async () => undefined,
    createOrg: async () => undefined,
    isAuthenticated: true,
    isLoading: false,
    login: async () => {
      throw new Error("Unused login");
    },
    logout: async () => undefined,
    orgs: [],
    platformOrgs: [],
    platformOrgsError: false,
    refreshPlatformOrgs: async () => undefined,
    refreshSession: async () => undefined,
    setup: async () => undefined,
    switchOrg: async () => undefined,
    updateOrg: async () => undefined,
    user: {
      email: "platform@example.com",
      id: "user_platform",
      isPlatformAdmin,
    },
  };
}

const ROUTE = "/organization/:orgId/sessions/:sessionId/steps";

async function render(
  initialEntry: string,
  page: ReactNode,
  authValue = auth(true),
  guarded = false
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <AuthContext.Provider value={authValue}>
            <Routes>
              {guarded ? (
                <Route element={<PlatformAdminGuard />}>
                  <Route element={page} path={ROUTE} />
                </Route>
              ) : (
                <Route element={page} path={ROUTE} />
              )}
              <Route element={<output data-chat />} path="/chat" />
            </Routes>
          </AuthContext.Provider>
          <Location />
        </MemoryRouter>
      </QueryClientProvider>
    );
    await settle();
  });
  await act(async () => {
    await settle();
  });

  return container;
}

function link(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll("a")).find(
    (anchor) => anchor.textContent === label
  );
}

const step = {
  actor: "agent" as const,
  completedAt: "2026-01-01T11:00:01.000Z",
  id: 2,
  outcome: "success" as const,
  startedAt: "2026-01-01T11:00:00.000Z",
  toolName: "read_file",
};

test("reads the path org instead of the active org and links to older pages", async () => {
  const getSteps = spySteps({
    next: { id: 150, startedAt: "2026-01-01T13:00:00.000Z" },
    previous: { id: 1, startedAt: "2026-01-01T10:00:00.000Z" },
    step,
  });

  const container = await render(
    `${ROUTE.replace(":orgId", "org_path").replace(":sessionId", "session_path")}?at=2026-01-01T11:00:00.000Z&id=2`,
    <SessionStepsPage />
  );

  expect(getSteps).toHaveBeenCalledWith("org_path", "session_path", {
    at: "2026-01-01T11:00:00.000Z",
    id: 2,
  });
  expect(container.textContent).toContain("read_file");

  const previous = link(container, "Previous");
  const next = link(container, "Next");
  const previousUrl = new URL(previous?.getAttribute("href") ?? "", "http://x");
  const nextUrl = new URL(next?.getAttribute("href") ?? "", "http://x");

  expect(previousUrl.pathname).toBe(
    "/organization/org_path/sessions/session_path/steps"
  );
  expect(previousUrl.searchParams.get("id")).toBe("1");
  expect(previousUrl.searchParams.get("at")).toBe("2026-01-01T10:00:00.000Z");
  expect(nextUrl.searchParams.get("id")).toBe("150");
});

test("does not auto-select a later step when the time has none", async () => {
  spySteps({
    next: { id: 1, startedAt: "2026-01-01T10:00:00.000Z" },
    previous: null,
    step: null,
  });

  const container = await render(
    `${ROUTE.replace(":orgId", "org_path").replace(":sessionId", "session_path")}?at=2026-01-01T09:00:00.000Z`,
    <SessionStepsPage />
  );

  expect(container.querySelector("dl")).toBeNull();
  expect(link(container, "Next")?.getAttribute("href")).toContain("id=1");

  const previous = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Previous"
  );

  expect(previous?.hasAttribute("disabled")).toBe(true);
});

test("guards the recording route for platform admins only", async () => {
  spySteps({
    next: null,
    previous: null,
    step,
  });

  const orgOnly = await render(
    "/organization/org_path/sessions/session_path/steps",
    <SessionStepsPage />,
    auth(false),
    true
  );

  expect(orgOnly.querySelector("[data-chat]")).not.toBeNull();
  expect(orgOnly.querySelector("h2")).toBeNull();

  const platform = await render(
    "/organization/org_path/sessions/session_path/steps",
    <SessionStepsPage />,
    auth(true),
    true
  );

  expect(platform.textContent).toContain("Session recording");
});

test("rejects an invalid step id without fetching", async () => {
  const getSteps = spySteps({
    next: null,
    previous: null,
    step,
  });

  for (const id of [
    "abc",
    "0",
    "1.5",
    "-1",
    "0x10",
    "1e3",
    "9007199254740993",
  ]) {
    const container = await render(
      `${ROUTE.replace(":orgId", "org_path").replace(":sessionId", "session_path")}?id=${encodeURIComponent(id)}`,
      <SessionStepsPage />
    );

    expect(container.querySelector("[role='alert']")).not.toBeNull();
  }

  expect(getSteps).not.toHaveBeenCalled();
});

test("sends a valid id even when at is present so the id selects the step", async () => {
  const getSteps = spySteps({
    next: null,
    previous: null,
    step,
  });

  await render(
    `${ROUTE.replace(":orgId", "org_path").replace(":sessionId", "session_path")}?at=2026-01-01T10:00:00.000Z&id=3`,
    <SessionStepsPage />
  );

  expect(getSteps).toHaveBeenCalledTimes(1);
  expect(getSteps).toHaveBeenCalledWith("org_path", "session_path", {
    at: "2026-01-01T10:00:00.000Z",
    id: 3,
  });
});
