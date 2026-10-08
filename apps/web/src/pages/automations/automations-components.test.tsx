import { expect, test } from "bun:test";
import type {
  AutomationRunRecord,
  StoredAutomation,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NotificationList } from "@/components/notifications/notification-list";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { queryKeys } from "@/lib/query-keys";
import { RunHistoryList } from "./automations-components";
import {
  type AutomationsPageState,
  useAutomationsPage,
} from "./use-automations-page";

test("automation notification opens the automation under its agent", async () => {
  const previousState = useActiveChatProfileStore.getState();
  useActiveChatProfileStore.setState({ profileId: "agent-a" });
  const container = document.createElement("div");
  const root = createRoot(container);
  let location = "";

  function LocationProbe() {
    const current = useLocation();
    location = current.pathname + current.search;

    return null;
  }

  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/notifications"]}>
          <NotificationList
            items={[
              {
                count: 1,
                description: "1 unread automation run",
                href: "/automations?automation=run-b",
                id: "automation-run-b",
                kind: "automation-run",
                kindLabel: "Automation",
                profileId: "agent-b",
                title: "Run B",
              },
            ]}
          />
          <LocationProbe />
        </MemoryRouter>
      )
    );
    await act(async () => container.querySelector("a")!.click());
    expect(useActiveChatProfileStore.getState().profileId).toBe("agent-b");
    expect(location).toBe("/automations?automation=run-b");
  } finally {
    await act(async () => root.unmount());
    useActiveChatProfileStore.setState(previousState);
  }
});

test("automations follow the selected agent and Super Bot shows all", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const automations = ["agent-a", "agent-b", "super"].map(
    (profileId): StoredAutomation => ({
      createdAt: "2026-10-01T00:00:00Z",
      description: "",
      enabled: true,
      id: profileId,
      name: profileId,
      profileId,
      prompt: "Run task",
      steps: [],
      trigger: { type: "manual" },
      updatedAt: "2026-10-01T00:00:00Z",
      version: 1,
    })
  );

  queryClient.setQueryData(queryKeys.automations.all, { automations });
  queryClient.setQueryData(queryKeys.profiles.all, [
    { id: "agent-a" },
    { id: "agent-b" },
    { id: "super", isSuper: true },
  ]);

  for (const automation of automations) {
    queryClient.setQueryData(queryKeys.automations.runs(automation.id), []);
  }

  const previousState = useActiveChatProfileStore.getState();
  useActiveChatProfileStore.setState({ profileId: "agent-a" });
  let page!: AutomationsPageState;

  function Probe() {
    page = useAutomationsPage();

    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/automations?automation=agent-b"]}>
          <QueryClientProvider client={queryClient}>
            <AuthContext.Provider
              value={
                /* SAFETY: The unauthenticated view reads only these auth flags. */
                { isAuthenticated: false, isLoading: false } as AuthContextValue
              }
            >
              <Probe />
            </AuthContext.Provider>
          </QueryClientProvider>
        </MemoryRouter>
      )
    );
    expect(page.automations.map((item) => item.id)).toEqual(["agent-a"]);
    expect(page.selected?.id).toBe("agent-a");
    await act(async () =>
      useActiveChatProfileStore.setState({ profileId: "super" })
    );
    expect(page.automations).toEqual(automations);
    expect(page.selected?.id).toBe("agent-b");
    await act(async () => page.setSearchQuery("agent-b"));
    expect(page.filteredAutomations.map((item) => item.id)).toEqual([
      "agent-b",
    ]);
    await act(async () =>
      useActiveChatProfileStore.setState({ profileId: "agent-a" })
    );
    expect(page.filteredAutomations).toEqual([]);
    expect(page.selected?.id).toBe("agent-a");
    await act(async () =>
      useActiveChatProfileStore.setState({ profileId: "empty-agent" })
    );
    expect(page.automations).toEqual([]);
    expect(page.selected).toBeNull();
    expect(page.selectedId).toBeNull();
  } finally {
    await act(async () => root.unmount());
    useActiveChatProfileStore.setState(previousState);
    queryClient.clear();
  }
});

test("keeps the run conversation mounted until the drawer finishes closing", async () => {
  const run: AutomationRunRecord = {
    automationId: "automation",
    completedAt: "2026-10-01T00:01:00Z",
    error: null,
    id: "run",
    output: null,
    startedAt: "2026-10-01T00:00:00Z",
    status: "completed",
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getAnimations"
  );

  const closing = Promise.withResolvers<void>();
  let animating = false;
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => (animating ? [{ finished: closing.promise }] : []),
  });

  try {
    await act(async () => {
      root.render(
        <RunHistoryList
          busy={false}
          onDeleteRun={() => {}}
          onRerun={() => {}}
          profileId="profile"
          running={false}
          runs={[run]}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]'
    )!;

    await act(async () => {
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const conversation = document.querySelector('[role="dialog"] [role="log"]');
    expect(conversation).not.toBeNull();
    animating = true;
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close run conversation"]'
        )!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(document.querySelector('[role="dialog"] [role="log"]')).toBe(
      conversation
    );
    await act(async () => {
      animating = false;
      closing.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      trigger.click();
    });
    expect(
      document.querySelector('[role="dialog"] [role="log"]')
    ).not.toBeNull();
  } finally {
    closing.resolve();
    await act(async () => root.unmount());
    container.remove();

    if (original) {
      Object.defineProperty(Element.prototype, "getAnimations", original);
    } else {
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    }
  }
});
