import { expect, mock, spyOn, test } from "bun:test";
import type {
  AutomationRunRecord,
  StoredAutomation,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { VirtuosoMockContext } from "react-virtuoso";
import { NotificationList } from "@/components/notifications/notification-list";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ThemeProvider } from "@/context/theme-context";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { AutomationDetailPanel } from "./automation-detail-panel";
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

  const getRun = spyOn(client, "getAutomationRun").mockResolvedValue(run);

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <RunHistoryList
            busy={false}
            onRerun={() => {}}
            profileId="profile"
            running={false}
            runs={[run]}
          />
        </QueryClientProvider>
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
    getRun.mockRestore();

    if (original) {
      Object.defineProperty(Element.prototype, "getAnimations", original);
    } else {
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    }
  }
});

test("a finished run loads its transcript when opened", async () => {
  const run: AutomationRunRecord = {
    automationId: "automation",
    completedAt: "2026-10-01T00:01:00Z",
    error: null,
    id: "run",
    output: "Done.",
    startedAt: "2026-10-01T00:00:00Z",
    status: "completed",
  };

  const getRun = spyOn(client, "getAutomationRun").mockResolvedValue({
    ...run,
    progress: [
      { content: "Check the inbox", role: "user" },
      { content: "Two urgent emails.", role: "assistant" },
    ],
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ThemeProvider>
            <AuthContext.Provider
              value={
                /* SAFETY: The transcript reads only the authentication flags. */
                { isAuthenticated: true, isLoading: false } as AuthContextValue
              }
            >
              <VirtuosoMockContext.Provider
                value={{ itemHeight: 100, viewportHeight: 2000 }}
              >
                <RunHistoryList
                  busy={false}
                  onRerun={() => {}}
                  profileId="profile"
                  running={false}
                  runs={[run]}
                />
              </VirtuosoMockContext.Provider>
            </AuthContext.Provider>
          </ThemeProvider>
        </QueryClientProvider>
      );
    });

    expect(getRun).not.toHaveBeenCalled();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(getRun).toHaveBeenCalledWith("automation", "run");
    const conversation = document.querySelector('[role="dialog"] [role="log"]');
    // Both transcript messages render, not only the output.
    expect(conversation?.querySelectorAll(".is-user")).toHaveLength(1);
    expect(conversation?.querySelectorAll(".is-assistant")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    getRun.mockRestore();
  }
});

test("opens a run whose transcript saved an artifact", async () => {
  const artifactPath =
    "/home/test/.nakama/orgs/org_1/profiles/profile/artifacts/report.md";

  const run: AutomationRunRecord = {
    automationId: "automation",
    completedAt: "2026-10-01T00:01:00Z",
    error: null,
    id: "run",
    output: "Saved the report.",
    progress: [
      {
        content: "",
        role: "assistant",
        toolCalls: [
          {
            arguments: { content: "# Report", path: "artifacts/report.md" },
            id: "call-1",
            name: "write_file",
          },
        ],
      },
      {
        content: JSON.stringify({ bytesWritten: 8, path: artifactPath }),
        name: "write_file",
        role: "tool",
        toolCallId: "call-1",
      },
      { content: "Saved the report.", role: "assistant" },
    ],
    startedAt: "2026-10-01T00:00:00Z",
    status: "completed",
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ThemeProvider>
            <AuthContext.Provider
              value={
                /* SAFETY: The artifact chip reads only the authentication flags. */
                { isAuthenticated: true, isLoading: false } as AuthContextValue
              }
            >
              <VirtuosoMockContext.Provider
                value={{ itemHeight: 100, viewportHeight: 2000 }}
              >
                <RunHistoryList
                  busy={false}
                  onRerun={() => {}}
                  profileId="profile"
                  running={false}
                  runs={[run]}
                />
              </VirtuosoMockContext.Provider>
            </AuthContext.Provider>
          </ThemeProvider>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const conversation = document.querySelector('[role="dialog"] [role="log"]');
    expect(conversation).not.toBeNull();
    expect(conversation!.textContent).toContain("report.md");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("a completed run saves as a test case for org members only", async () => {
  const run: AutomationRunRecord = {
    automationId: "automation",
    completedAt: "2026-10-01T00:01:00Z",
    error: null,
    id: "run",
    output: "  The report is ready.  ",
    startedAt: "2026-10-01T00:00:00Z",
    status: "completed",
  };

  const create = spyOn(client, "createRegressionCase").mockResolvedValue(
    // SAFETY: The drawer ignores the saved case it gets back.
    {} as Awaited<ReturnType<typeof client.createRegressionCase>>
  );

  const getRun = spyOn(client, "getAutomationRun").mockResolvedValue(run);

  const until = async <T,>(find: () => T | null): Promise<T> => {
    for (let attempt = 0; attempt < 50 && !find(); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    return find()!;
  };

  try {
    // No active org (role undefined) is the reachable non-member state
    for (const role of [undefined, "member"] as const) {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);

      try {
        await act(async () => {
          root.render(
            <QueryClientProvider client={new QueryClient()}>
              <AuthContext.Provider
                value={
                  /* SAFETY: The drawer reads only the active org's role. */
                  { activeOrg: role ? { role } : null } as AuthContextValue
                }
              >
                <RunHistoryList
                  busy={false}
                  onRerun={() => {}}
                  profileId="profile"
                  running={false}
                  runs={[run]}
                />
              </AuthContext.Provider>
            </QueryClientProvider>
          );
        });
        await act(async () => {
          container
            .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
            .click();
        });

        // The drawer header renders before the run's actions
        await until(() =>
          document.querySelector('button[aria-label="Copy run ID"]')
        );

        const save = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Save as test case"]'
        );

        if (!role) {
          expect(save).toBeNull();
          continue;
        }

        await act(async () => save!.click());

        const submit = await until(() =>
          document.querySelector<HTMLButtonElement>(
            'form button[type="submit"]'
          )
        );

        await act(async () => submit.click());
        await until(() => (create.mock.calls.length > 0 ? true : null));

        expect(create).toHaveBeenCalledWith("profile", {
          automationId: "automation",
          expectedResult: "The report is ready.",
          sourceId: "run",
          sourceType: "automation_run",
        });
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    }

    expect(create).toHaveBeenCalledTimes(1);
  } finally {
    create.mockRestore();
    getRun.mockRestore();
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

test("editor limits tools to what the user leaves ticked", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false } },
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  let draft: StoredAutomation = {
    createdAt: "2026-10-01T00:00:00Z",
    description: "",
    enabled: true,
    id: "automation",
    name: "Briefing",
    profileId: "agent",
    prompt: "Brief me",
    steps: [],
    trigger: { type: "manual" },
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
        toolOptions={{
          composioToolkits: [{ id: "gmail", label: "gmail" }],
          mcpServerIds: [{ id: "mcp_calendar", label: "calendar" }],
          toolIds: [
            { id: "tool_bash", label: "bash" },
            { id: "tool_read", label: "read_file" },
          ],
        }}
      />
    );
  }

  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Editor />
        </QueryClientProvider>
      )
    );
    expect(draft.toolLimit).toBeUndefined();

    await act(async () =>
      container
        .querySelector<HTMLElement>(
          `[aria-label="Use all of the agent's tools"]`
        )!
        .click()
    );
    expect(draft.toolLimit).toEqual({
      composioToolkits: ["gmail"],
      mcpServerIds: ["mcp_calendar"],
      toolIds: ["tool_bash", "tool_read"],
    });

    const bash = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent === "bash"
    )!;

    await act(async () => bash.click());
    expect(draft.toolLimit?.toolIds).toEqual(["tool_read"]);

    await act(async () =>
      container
        .querySelector<HTMLElement>(
          `[aria-label="Use all of the agent's tools"]`
        )!
        .click()
    );
    expect(draft.toolLimit).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  }
});

function webhookAutomation(
  trigger: StoredAutomation["trigger"],
  id = "automation"
): StoredAutomation {
  return {
    createdAt: "2026-10-01T00:00:00Z",
    description: "",
    enabled: true,
    id,
    name: "Task",
    profileId: "agent",
    prompt: "Run task",
    steps: [],
    trigger,
    updatedAt: "2026-10-01T00:00:00Z",
    version: 1,
  };
}

test("editor shows the webhook trigger and warns before a save drops it", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false } },
  });

  const container = document.createElement("div");
  const root = createRoot(container);
  const patches: Partial<StoredAutomation>[] = [];

  function render(
    trigger: StoredAutomation["trigger"],
    savedTrigger?: StoredAutomation["trigger"]
  ) {
    return act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AutomationEditorForm
            automation={webhookAutomation(trigger)}
            busy={false}
            onChange={(patch) => patches.push(patch)}
            profiles={[]}
            savedTrigger={savedTrigger}
          />
        </QueryClientProvider>
      )
    );
  }

  function clickPill(label: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === label
    )!;

    return act(async () => button.click());
  }

  try {
    await render({ type: "webhook" }, { type: "webhook" });

    const webhookPill = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === "On webhook"
    );

    expect(webhookPill?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("Next run");
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await clickPill("Every day");
    expect(patches.pop()?.trigger).toEqual({
      cron: "0 7 * * *",
      timezone: undefined,
      type: "schedule",
    });

    await render({ type: "manual" }, { type: "webhook" });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    await clickPill("On webhook");
    expect(patches.pop()?.trigger).toEqual({ type: "webhook" });

    await render({ type: "webhook" });
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await render({ type: "manual" });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
  }
});

test("run history marks runs that a webhook started", async () => {
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
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <RunHistoryList
          busy={false}
          onRerun={() => {}}
          profileId="profile"
          running={false}
          runs={[{ ...run, id: "hook", source: "webhook" }, run]}
        />
      )
    );

    const rows = Array.from(container.querySelectorAll("li"));

    const badges = (row: Element) =>
      Array.from(row.querySelectorAll("span")).filter(
        (span) => span.textContent === "Webhook"
      ).length;

    expect(rows.map(badges)).toEqual([1, 0]);
  } finally {
    await act(async () => root.unmount());
  }
});

function renderDetailPanel(
  root: ReturnType<typeof createRoot>,
  queryClient: QueryClient,
  automation: StoredAutomation
) {
  return act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AutomationDetailPanel
          busy={false}
          handleRun={async () => {}}
          handleToggleEnabled={async () => {}}
          key={automation.id}
          openEdit={() => {}}
          runningId={null}
          runs={[]}
          runsLoading={false}
          selected={automation}
          selectedProfileName="Agent"
          selectedRunSummary={{
            completed: 0,
            failed: 0,
            running: 0,
            unread: 0,
          }}
          setDeleteTarget={() => {}}
        />
      </QueryClientProvider>
    )
  );
}

function buttonByLabel(label: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label
  );
}

test("detail panel shows the webhook URL and a new secret only once", async () => {
  const queryClient = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const createSecret = spyOn(client, "createAutomationWebhookSecret")
    .mockResolvedValueOnce("new-secret-value")
    .mockRejectedValueOnce(new Error("Set NAKAMA_SECRETS_KEY"));

  const codes = () =>
    Array.from(container.querySelectorAll("code")).map(
      (code) => code.textContent
    );

  try {
    await renderDetailPanel(
      root,
      queryClient,
      webhookAutomation({ type: "manual" }, "a/b")
    );
    expect(codes()).toEqual([]);
    expect(buttonByLabel("New secret")).toBeUndefined();

    await renderDetailPanel(
      root,
      queryClient,
      webhookAutomation({ type: "webhook" }, "a/b")
    );
    expect(codes()).toEqual([
      `${window.location.origin}/v1/automations/a%2Fb/webhook`,
    ]);

    const configured =
      "https://nakama.example.com/v1/automations/a%2Fb/webhook";

    await renderDetailPanel(root, queryClient, {
      ...webhookAutomation({ type: "webhook" }, "a/b"),
      webhookUrl: configured,
    });
    expect(codes()).toEqual([configured]);

    await act(async () => buttonByLabel("New secret")!.click());
    await act(async () => {
      buttonByLabel("Make secret")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(createSecret).toHaveBeenLastCalledWith("a/b");
    expect(codes()).toContain("new-secret-value");

    await act(async () => buttonByLabel("New secret")!.click());
    await act(async () => {
      buttonByLabel("Make secret")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(createSecret).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector('[role="dialog"] [role="alert"]')
    ).not.toBeNull();
    expect(codes()).toContain("new-secret-value");

    await renderDetailPanel(
      root,
      queryClient,
      webhookAutomation({ type: "webhook" }, "other")
    );
    expect(codes()).not.toContain("new-secret-value");
  } finally {
    createSecret.mockRestore();
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  }
});

test("a double click on Make secret sends one request", async () => {
  const queryClient = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  let resolveSecret: (value: string) => void = () => {};

  const createSecret = spyOn(
    client,
    "createAutomationWebhookSecret"
  ).mockReturnValue(
    new Promise<string>((resolve) => {
      resolveSecret = resolve;
    })
  );

  try {
    await renderDetailPanel(
      root,
      queryClient,
      webhookAutomation({ type: "webhook" })
    );
    await act(async () => buttonByLabel("New secret")!.click());
    await act(async () => {
      const confirm = buttonByLabel("Make secret")!;
      confirm.click();
      confirm.click();
    });
    expect(createSecret).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSecret("pending-secret");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("pending-secret");
  } finally {
    createSecret.mockRestore();
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  }
});

test("copy button shows copied, or a failure when the clipboard is missing", async () => {
  const queryClient = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = mock(async (_text: string) => {});

  function setClipboard(value: { writeText: typeof writeText } | undefined) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value,
    });
  }

  try {
    await renderDetailPanel(
      root,
      queryClient,
      webhookAutomation({ type: "webhook" })
    );

    setClipboard({ writeText });
    await act(async () => buttonByLabel("Copy")!.click());
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/v1/automations/automation/webhook`
    );
    expect(buttonByLabel("Copied")).toBeDefined();

    await renderDetailPanel(
      root,
      queryClient,
      webhookAutomation({ type: "webhook" }, "other")
    );
    setClipboard(undefined);
    await act(async () => buttonByLabel("Copy")!.click());
    expect(buttonByLabel("Copy failed")).toBeDefined();
  } finally {
    if (original) {
      Object.defineProperty(navigator, "clipboard", original);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }

    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  }
});
