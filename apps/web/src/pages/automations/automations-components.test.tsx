import { expect, spyOn, test } from "bun:test";
import type {
  AutomationRunRecord,
  StoredAutomation,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NotificationList } from "@/components/notifications/notification-list";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { AutomationEditorForm, RunHistoryList } from "./automations-components";
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

test("automations follow the selected agent and Super Nakama shows all", async () => {
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

    await act(async () => {
      await queryClient
        .fetchQuery({
          queryFn: () => Promise.reject(new Error("Request failed")),
          queryKey: queryKeys.automations.all,
          staleTime: 0,
        })
        .catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(page.error).not.toBeNull();
    await act(async () => {
      queryClient.setQueryData(queryKeys.automations.all, { automations });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(page.error).toBeNull();
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
          onRerun={() => {}}
          profileId="profile"
          running={false}
          runs={[run]}
        />
      );
    });

    expect(
      container.querySelector('button[aria-label^="Delete run"]')
    ).toBeNull();

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

test("marking runs read avoids duplicate requests and recovers after failure", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const run: AutomationRunRecord = {
    automationId: "automation",
    completedAt: "2026-10-01T00:01:00Z",
    error: null,
    id: "run",
    output: null,
    read: false,
    startedAt: "2026-10-01T00:00:00Z",
    status: "completed",
  };

  const automation: StoredAutomation = {
    createdAt: run.startedAt,
    description: "",
    enabled: true,
    id: run.automationId,
    name: "Automation",
    profileId: "agent-a",
    prompt: "Run task",
    steps: [],
    trigger: { type: "manual" },
    updatedAt: run.startedAt,
    version: 1,
  };

  const runsKey = queryKeys.automations.runs(run.automationId);
  queryClient.setQueryData(queryKeys.automations.all, {
    automations: [automation],
    unread: { byAutomationId: { [automation.id]: 1 }, totalUnread: 1 },
  });

  const listAutomations = spyOn(client, "listAutomations").mockResolvedValue({
    automations: [automation],
    unread: { byAutomationId: {}, totalUnread: 0 },
  });

  queryClient.setQueryData(queryKeys.profiles.all, [{ id: "agent-a" }]);
  queryClient.setQueryData(runsKey, [run]);
  const marking = Promise.withResolvers<string>();
  const refreshing = Promise.withResolvers<AutomationRunRecord[]>();

  const markRead = spyOn(client, "markAutomationRunsRead").mockReturnValue(
    marking.promise
  );

  const listRuns = spyOn(client, "listAutomationRuns").mockReturnValue(
    refreshing.promise
  );

  const previousState = useActiveChatProfileStore.getState();
  useActiveChatProfileStore.setState({ profileId: "agent-a" });
  const container = document.createElement("div");
  const root = createRoot(container);

  function Probe() {
    useAutomationsPage();

    return null;
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <AuthContext.Provider
              value={
                /* SAFETY: This test only needs the authentication flags. */
                { isAuthenticated: true, isLoading: false } as AuthContextValue
              }
            >
              <Probe />
            </AuthContext.Provider>
          </QueryClientProvider>
        </MemoryRouter>
      )
    );
    expect(markRead).toHaveBeenCalledTimes(1);
    await act(async () => {
      queryClient.setQueryData(runsKey, [{ ...run, output: "Updated output" }]);
    });
    await settle();
    expect(markRead).toHaveBeenCalledTimes(1);

    await act(async () => marking.resolve("2026-10-01T00:02:00Z"));
    await settle();
    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(listAutomations).toHaveBeenCalledTimes(1);
    await act(async () => {
      queryClient.setQueryData(runsKey, [
        { ...run, output: "Refresh pending" },
      ]);
    });
    await settle();
    expect(markRead).toHaveBeenCalledTimes(1);
    await act(async () => refreshing.resolve([{ ...run, read: true }]));
    await settle();
    expect(markRead).toHaveBeenCalledTimes(1);

    // A delayed list response must not turn already-read history into another write.
    await act(async () => {
      queryClient.setQueryData(queryKeys.automations.all, {
        automations: [automation],
        unread: { byAutomationId: { [automation.id]: 1 }, totalUnread: 1 },
      });
      queryClient.setQueryData(runsKey, [{ ...run, read: true }]);
    });
    await settle();
    expect(markRead).toHaveBeenCalledTimes(1);

    await act(async () =>
      queryClient.setQueryData(runsKey, [{ ...run, id: "new-run" }])
    );
    await settle();
    expect(markRead).toHaveBeenCalledTimes(2);

    markRead.mockRejectedValueOnce(new Error("Request failed"));
    await act(async () =>
      queryClient.setQueryData(runsKey, [{ ...run, id: "retry-run" }])
    );
    await settle();
    expect(markRead).toHaveBeenCalledTimes(3);
    await settle();
    expect(markRead).toHaveBeenCalledTimes(3);
    // The next poll can return identical unread data after a failed write.
    await act(async () =>
      queryClient.setQueryData(runsKey, [{ ...run, id: "retry-run" }])
    );
    await settle();
    expect(markRead).toHaveBeenCalledTimes(4);
  } finally {
    marking.resolve("2026-10-01T00:02:00Z");
    refreshing.resolve([{ ...run, read: true }]);
    await act(async () => root.unmount());
    useActiveChatProfileStore.setState(previousState);
    markRead.mockRestore();
    listRuns.mockRestore();
    listAutomations.mockRestore();
    queryClient.clear();
  }
});

test("editor presets preserve time and timezone, and delivery selection preserves settings", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false } },
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  let draft: StoredAutomation = {
    createdAt: "2026-10-01T00:00:00Z",
    delivery: { channel: "email", notifyOn: "both", to: "test@example.com" },
    description: "",
    enabled: true,
    id: "automation",
    name: "Morning briefing",
    profileId: "agent",
    prompt: "Run task",
    steps: [],
    trigger: { cron: "30 9 * * *", timezone: "Asia/Jakarta", type: "schedule" },
    updatedAt: "2026-10-01T00:00:00Z",
    version: 1,
  };

  function Editor() {
    const [value, setValue] = useState(draft);
    draft = value;

    return (
      <AutomationEditorForm
        automation={value}
        busy={false}
        onChange={(patch) => setValue((current) => ({ ...current, ...patch }))}
        profiles={[]}
      />
    );
  }

  async function click(text: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === text
    )!;

    expect(button).toBeDefined();
    await act(async () => button.click());
  }

  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Editor />
        </QueryClientProvider>
      )
    );
    expect(container.querySelector("details")?.open).toBe(false);
    expect(document.querySelector('input[type="time"]')).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Pick a time"]')!
        .click()
    );
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-slot="popover-content"] input[type="time"]'
      )?.value
    ).toBe("09:30");
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-slot="popover-content"] button'
        )!
        .click()
    );
    expect(document.querySelector('input[type="time"]')).toBeNull();
    await click("Weekdays");
    expect(draft.trigger).toEqual({
      cron: "30 9 * * 1-5",
      timezone: "Asia/Jakarta",
      type: "schedule",
    });
    await click("Every day");
    expect(draft.trigger).toEqual({
      cron: "30 9 * * *",
      timezone: "Asia/Jakarta",
      type: "schedule",
    });
    await click("Weekly");
    expect(draft.trigger).toEqual({
      cron: "30 9 * * 1",
      timezone: "Asia/Jakarta",
      type: "schedule",
    });
    await click("Monthly");
    expect(draft.trigger).toEqual({
      cron: "30 9 1 * *",
      timezone: "Asia/Jakarta",
      type: "schedule",
    });

    const morning = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Morning"]'
    )!;

    await act(async () => morning.click());
    expect(draft.trigger).toEqual({
      cron: "0 7 1 * *",
      timezone: "Asia/Jakarta",
      type: "schedule",
    });
    expect(container.querySelector('input[type="time"]')).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Pick a time"]')!
        .click()
    );
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-slot="popover-content"] input[type="time"]'
      )?.value
    ).toBe("07:00");
    expect(
      document.querySelectorAll('[data-slot="popover-content"] [role="option"]')
    ).toHaveLength(96);

    const option = document.querySelector<HTMLElement>(
      '[data-slot="popover-content"] [data-value="11:00"]'
    )!;

    await act(async () => option.click());
    expect(draft.trigger).toEqual({
      cron: "0 11 1 * *",
      timezone: "Asia/Jakarta",
      type: "schedule",
    });
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Pick a time"]')!
        .click()
    );
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-slot="popover-content"] input[type="time"]'
      )?.value
    ).toBe("11:00");
    expect(
      document
        .querySelector('[data-slot="popover-content"] [data-value="11:00"]')
        ?.getAttribute("data-checked")
    ).toBe("true");

    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-slot="popover-content"] button'
        )!
        .click()
    );
    expect(document.querySelector('input[type="time"]')).toBeNull();
    await click("Email");
    expect(draft.delivery).toEqual({
      channel: "email",
      notifyOn: "both",
      to: "test@example.com",
    });
    await click("Telegram");
    expect(draft.delivery).toEqual({ channel: "telegram", notifyOn: "both" });
    await click("Nowhere");
    expect(draft.delivery).toBeUndefined();
    await click("Only when I ask");
    expect(draft.trigger).toEqual({ type: "manual" });
    expect(container.querySelector('input[type="time"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  }
});

test("editor retains custom and one-time triggers until a preset is selected", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false } },
  });

  const container = document.createElement("div");
  const root = createRoot(container);
  const patches: Partial<StoredAutomation>[] = [];

  try {
    for (const trigger of [
      { cron: "*/15 * * * *", timezone: "Asia/Jakarta", type: "schedule" },
      { at: "2026-11-01T08:00:00", timezone: "Asia/Jakarta", type: "runAt" },
    ] as const) {
      const automation: StoredAutomation = {
        createdAt: "2026-10-01T00:00:00Z",
        description: "",
        enabled: true,
        id: "automation",
        name: "Task",
        profileId: "agent",
        prompt: "Run task",
        steps: [],
        trigger,
        updatedAt: "2026-10-01T00:00:00Z",
        version: 1,
      };

      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <AutomationEditorForm
              automation={automation}
              busy={false}
              onChange={(patch) => patches.push(patch)}
              profiles={[]}
            />
          </QueryClientProvider>
        )
      );
      expect(patches).toEqual([]);
      expect(container.querySelector('input[type="time"]')).toBeNull();
      expect(
        container.querySelector('[aria-pressed="true"]')?.textContent
      ).toBe("Nowhere");

      const button = Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "Weekdays"
      )!;

      await act(async () => button.click());
      expect(patches.pop()?.trigger).toEqual({
        cron: "0 7 * * 1-5",
        timezone: "Asia/Jakarta",
        type: "schedule",
      });
    }
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
  }
});
