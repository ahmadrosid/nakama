import { expect, spyOn, test } from "bun:test";
import type {
  AuthUserResponse,
  ListNotificationDestinationsResponse,
  NotificationDestinationSummary,
  UserOrgSummary,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NotificationDestinationsCard } from "@/components/NotificationDestinationsCard";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { WhatsAppSettingsCard } from "@/components/WhatsAppSettingsCard";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import { AuthProvider } from "@/context/auth-context";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { useAuth } from "@/context/use-auth";
import { ChannelProfileContext } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { queryClient as appQueryClient } from "@/lib/query-client";
import { visibleIntegrationSections } from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";
import { IntegrationsPage } from "./IntegrationsPage";
import {
  ProfileChannelSettingsPage,
  ProfileConnections,
} from "./profiles/profile-config-tab";

test("channel setup stays on the agent page and Connect apps excludes messaging channels", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  const auth: AuthContextValue = {
    activeOrg: {
      createdAt: "",
      id: "org-setup",
      name: "Setup",
      role: "admin",
      slug: "setup",
      updatedAt: "",
    },
    archiveOrg: async () => {},
    createOrg: async () => {},
    isAuthenticated: true,
    isLoading: false,
    login: async () => ({ email: "admin@example.com", id: "admin" }),
    logout: async () => {},
    orgs: [],
    refreshSession: async () => {},
    setup: async () => {},
    switchOrg: async () => {},
    updateOrg: async () => {},
    user: { email: "admin@example.com", id: "admin", isPlatformAdmin: true },
  };
  const previous = useActiveChatProfileStore.getState();
  useActiveChatProfileStore.setState({
    orgId: "org-setup",
    profileId: "agent-a",
  });
  const profiles = [
    { id: "agent-a", name: "Alpha" },
    { id: "agent-b", name: "Beta" },
  ];
  queryClient.setQueryData(queryKeys.profiles.all, profiles);
  const api = client.forOrg("org-setup");
  const scope = spyOn(client, "forOrg").mockReturnValue(api);
  const list = spyOn(api, "listLegacyChannels").mockResolvedValue([
    { global: true, platform: "telegram" },
  ]);
  const listProfiles = spyOn(client, "listProfiles").mockResolvedValue({
    profiles,
  } as Awaited<ReturnType<typeof client.listProfiles>>);
  const claim = spyOn(api, "claimLegacyChannel");
  const start = spyOn(api, "startWorker").mockResolvedValue({ ok: true });
  const restart = spyOn(api, "restartWorker").mockResolvedValue({ ok: true });
  const settings = spyOn(api, "getDiscordSettings").mockRejectedValue(
    new Error("Unavailable")
  );
  const saveDiscord = spyOn(api, "setDiscordSettings")
    .mockRejectedValueOnce(new Error("Invalid token"))
    .mockResolvedValue({
      allowedUserIds: [],
      botTokenMasked: "***",
      configured: true,
      handshakeCode: null,
      inviteUrl: null,
      pairedUserIds: [],
      profileId: "agent-b",
    });
  const telegramSettings = {
    allowedUserIds: [],
    botTokenMasked: "***",
    configured: true,
    handshakeCode: "link-code",
    pairedUserIds: [],
    profileId: "agent-b",
  };
  const saveTelegram = spyOn(api, "setTelegramSettings")
    .mockRejectedValueOnce(new Error("Invalid token"))
    .mockResolvedValue(telegramSettings);
  const getTelegram = spyOn(api, "getTelegramSettings")
    .mockResolvedValueOnce({
      ...telegramSettings,
      botTokenMasked: null,
      configured: false,
    })
    .mockResolvedValue({
      ...telegramSettings,
      pairedUserIds: [123],
    });
  const whatsappSettings = {
    allowedPhones: [],
    configured: false,
    pairedJid: null,
    pairingCode: null,
    phoneNumberMasked: null,
    profileId: "agent-b",
    requireGroupMention: true,
  };
  const saveWhatsApp = spyOn(api, "setWhatsAppSettings").mockResolvedValue({
    ...whatsappSettings,
    configured: true,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <MemoryRouter
              initialEntries={["/profiles/agent-b/channels/telegram"]}
            >
              <Routes>
                <Route
                  element={<ProfileChannelSettingsPage />}
                  path="/profiles/:profileId/channels/:channel"
                />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      await settle();
    });
    await act(settle);
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("details")?.open).toBe(false);
    expect(list).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(
      container.querySelector('[aria-current="step"] h2')?.textContent
    ).toBe("Add bot");
    expect(
      container.querySelector('[aria-label="Connection setup"]')
    ).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toContain(
      "agent-b"
    );
    queryClient.setQueryData(
      [...queryKeys.systemStatus, "org-setup", "agent-b"],
      {
        discordWorker: {
          configured: false,
          connected: false,
          paired: false,
          process: { managed: true },
          running: false,
        },
        slackWorker: {
          configured: false,
          connected: false,
          paired: false,
          running: false,
        },
        telegramWorker: { configured: true, paired: true, running: true },
        whatsappWorker: {
          configured: true,
          connected: false,
          paired: true,
          running: true,
        },
      }
    );
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <MemoryRouter key="connections">
              <Routes>
                <Route
                  element={
                    <ChannelProfileContext.Provider value="agent-b">
                      <ProfileConnections />
                    </ChannelProfileContext.Provider>
                  }
                  path="/"
                />
                <Route
                  element={<ProfileChannelSettingsPage />}
                  path="/profiles/:profileId/channels/:channel"
                />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    );
    expect(container.querySelectorAll("img")).toHaveLength(4);
    expect(
      container.querySelector('[aria-label="Connect Slack"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Settings Telegram"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Settings WhatsApp"]')?.textContent
    ).toContain("Offline");
    expect(
      container.querySelector('[aria-label="Connect Telegram"]')
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Settings Telegram"]')?.textContent
    ).toContain("Connected");
    expect(
      container.querySelector('[aria-label="Settings WhatsApp"]')?.textContent
    ).not.toContain("Connected");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      (
        container.querySelector(
          '[aria-label="Connect Discord"] img'
        ) as HTMLImageElement
      ).click();
      await settle();
    });
    await act(settle);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/profiles?profile=agent-b#profile-connections"
    );
    expect(settings).toHaveBeenCalledWith("agent-b");
    expect(
      container.querySelector('[aria-current="step"] h2')?.textContent
    ).toBe("Add bot");
    expect(
      container.querySelectorAll('[aria-label="Discord setup progress"] > li')
    ).toHaveLength(3);
    expect(
      container.querySelectorAll(
        '[aria-label="Discord setup progress"] [role="region"]'
      )
    ).toHaveLength(1);
    const pasteToken = async (token: string) => {
      await act(async () => {
        const event = new window.Event("paste", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "clipboardData", {
          value: { getData: () => token },
        });
        container
          .querySelector('[aria-label="Bot token"]')!
          .dispatchEvent(event);
        await settle();
      });
      await act(settle);
    };
    await pasteToken("invalid-token");
    expect(saveDiscord).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-current="step"] h2')?.textContent
    ).toBe("Add bot");
    start.mockRejectedValueOnce(new Error("Could not start connection"));
    await pasteToken("  valid-test-token  ");
    expect(saveDiscord).toHaveBeenLastCalledWith(
      {
        allowedUserIds: "",
        botToken: "valid-test-token",
        profileId: "agent-b",
      },
      "agent-b"
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith("discord", "agent-b");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(settle);
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.querySelector("#discord-profile")).toBeNull();
    expect(container.querySelector('[aria-label="Bot token"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Save changes"
      )
    ).toBe(false);
    const startButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Start connection"
    );
    expect(startButton).toBeDefined();
    expect(startButton?.closest("details")).toBeNull();
    await act(async () => {
      startButton!.click();
      await settle();
    });
    expect(start).toHaveBeenCalledWith("discord", "agent-b");
    const statusKey = [...queryKeys.systemStatus, "org-setup", "agent-b"];
    const previousStatus = queryClient.getQueryData(statusKey) as Record<
      string,
      unknown
    >;
    await act(async () => {
      queryClient.setQueryData(statusKey, {
        ...previousStatus,
        discordWorker: {
          configured: true,
          connected: true,
          paired: false,
          process: { managed: true },
          running: true,
        },
      });
      await settle();
    });
    expect(
      container.querySelector('[aria-current="step"] h2')?.textContent
    ).toBe("Link account");
    expect(container.querySelector('[aria-label="Bot token"]')).toBeNull();
    settings.mockResolvedValue({
      allowedUserIds: [],
      botTokenMasked: "***",
      configured: true,
      handshakeCode: null,
      inviteUrl: null,
      pairedUserIds: ["123"],
      profileId: "agent-b",
    });
    await act(async () => {
      queryClient.setQueryData(statusKey, {
        ...previousStatus,
        discordWorker: {
          configured: true,
          connected: true,
          paired: true,
          process: { managed: true },
          running: true,
        },
      });
      await settle();
    });
    await act(settle);
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect(
      container.querySelectorAll('[aria-label="Discord setup progress"] > li')
    ).toHaveLength(3);
    expect(
      container.querySelectorAll(
        '[aria-label="Discord setup progress"] [role="region"]'
      )
    ).toHaveLength(0);
    const editUsers = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Edit"
    );
    expect(editUsers?.closest("details")).toBeNull();
    expect(editUsers).toBeDefined();

    queryClient.setQueryData(
      [...queryKeys.telegram.settings, "org-setup", "agent-b"],
      {
        ...telegramSettings,
        botTokenMasked: null,
        configured: false,
      }
    );
    queryClient.setQueryData(statusKey, {
      ...previousStatus,
      telegramWorker: {
        configured: false,
        paired: false,
        process: { managed: true },
        running: false,
      },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <ChannelProfileContext.Provider value="agent-b">
              <TelegramSettingsCard embedded />
            </ChannelProfileContext.Provider>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      await settle();
    });
    await act(settle);
    expect(
      container.querySelector('[aria-current="step"] h2')?.textContent
    ).toBe("Add bot");
    start.mockClear();
    await pasteToken("invalid-telegram-token");
    expect(start).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await pasteToken(" telegram-test-token ");
    expect(saveTelegram).toHaveBeenLastCalledWith(
      {
        allowedUserIds: "",
        botToken: "telegram-test-token",
        profileId: "agent-b",
      },
      "agent-b"
    );
    expect(start).toHaveBeenCalledWith("telegram", "agent-b");
    await act(async () => {
      queryClient.setQueryData(statusKey, {
        ...previousStatus,
        telegramWorker: {
          configured: true,
          paired: false,
          process: { managed: true },
          running: true,
        },
      });
      await settle();
    });
    expect(
      container.querySelector('[aria-current="step"] h2')?.textContent
    ).toBe("Link account");
    expect(
      container.querySelectorAll(
        '[aria-label="Telegram setup progress"] [role="region"]'
      )
    ).toHaveLength(1);
    await act(async () => {
      queryClient.setQueryData(statusKey, {
        ...previousStatus,
        telegramWorker: {
          configured: true,
          paired: true,
          process: { managed: true },
          running: true,
        },
      });
      await settle();
    });
    await act(settle);
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.querySelector("#telegram-profile")).toBeNull();
    expect(container.querySelector('[aria-label="Bot token"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Save changes"
      )
    ).toBe(false);
    expect(
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Edit")
        ?.closest("details")
    ).toBeNull();

    queryClient.setQueryData(
      [...queryKeys.whatsapp.settings, "org-setup", "agent-b"],
      whatsappSettings
    );
    queryClient.setQueryData(statusKey, {
      ...previousStatus,
      whatsappWorker: {
        configured: false,
        paired: false,
        process: { managed: true },
        running: false,
      },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <ChannelProfileContext.Provider value="agent-b">
              <WhatsAppSettingsCard embedded />
            </ChannelProfileContext.Provider>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      await settle();
    });
    await act(settle);
    expect(
      container.querySelector('[aria-current="step"] h2')?.textContent
    ).toBe("Start connection");
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Connect WhatsApp")!
        .click();
      await settle();
    });
    await act(settle);
    expect(saveWhatsApp).toHaveBeenCalledWith(
      { profileId: "agent-b", requireGroupMention: true },
      "agent-b"
    );
    expect(start).toHaveBeenCalledWith("whatsapp", "agent-b");
    await act(async () => {
      queryClient.setQueryData(statusKey, {
        ...previousStatus,
        whatsappWorker: {
          configured: true,
          connected: false,
          paired: false,
          process: { managed: true },
          qrCode: "test-qr",
          running: true,
        },
      });
      await settle();
    });
    expect(
      container.querySelector('[aria-current="step"] h2')?.textContent
    ).toBe("Link account");
    expect(
      container
        .querySelector('[aria-label="Steps to connect WhatsApp"]')
        ?.closest("details")
    ).toBeNull();
    expect(
      container.querySelectorAll(
        '[aria-label="WhatsApp setup progress"] [role="region"]'
      )
    ).toHaveLength(1);
    await act(async () => {
      queryClient.setQueryData(
        [...queryKeys.whatsapp.settings, "org-setup", "agent-b"],
        {
          ...whatsappSettings,
          configured: true,
          pairedJid: "123@s.whatsapp.net",
        }
      );
      queryClient.setQueryData(statusKey, {
        ...previousStatus,
        whatsappWorker: {
          configured: true,
          connected: true,
          paired: true,
          process: { managed: true },
          running: true,
        },
      });
      await settle();
    });
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect(container.querySelector("details")?.open).toBe(false);
    await act(async () => {
      queryClient.setQueryData(statusKey, {
        ...previousStatus,
        whatsappWorker: {
          configured: true,
          connected: false,
          paired: true,
          process: { managed: true },
          running: false,
        },
      });
      await settle();
    });
    const whatsappStart = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Start connection"
    )!;
    expect(whatsappStart.closest("details")).toBeNull();
    await act(async () => {
      whatsappStart.click();
      await settle();
    });
    expect(start).toHaveBeenLastCalledWith("whatsapp", "agent-b");

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <ChannelProfileContext.Provider value="agent-b">
              <WorkerActionBar
                compact
                pm2Managed
                running
                showLogs={false}
                workerName="whatsapp"
              />
            </ChannelProfileContext.Provider>
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    );
    expect(
      [...container.querySelectorAll("button")].map(
        (button) => button.textContent
      )
    ).toEqual(["Disconnect", "More"]);
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "More")!
        .click();
      await settle();
    });
    await act(async () => {
      (document.querySelector('[role="menuitem"]') as HTMLElement).click();
      await settle();
    });
    expect(restart).toHaveBeenCalledWith("whatsapp", "agent-b");
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <MemoryRouter initialEntries={["/integrations?section=telegram"]}>
              <Routes>
                <Route element={<IntegrationsPage />} path="/integrations" />
                <Route
                  element={<IntegrationsPage />}
                  path="/customize/connections/:section"
                />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      await settle();
    });
    await act(settle);
    expect(
      container.querySelector('[aria-label="Integration settings"]')
    ).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Composio");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/customize"
    );
    expect(
      visibleIntegrationSections(true, "admin").map((item) => item.id)
    ).toEqual([
      "notifications",
      "composio",
      "coding-agents",
      "optimization",
      "error-tracking",
    ]);
    expect(
      visibleIntegrationSections(false, "member").map((item) => item.id)
    ).toEqual(["composio"]);
    expect(visibleIntegrationSections(false, "viewer")).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    scope.mockRestore();
    list.mockRestore();
    claim.mockRestore();
    listProfiles.mockRestore();
    settings.mockRestore();
    saveDiscord.mockRestore();
    saveTelegram.mockRestore();
    getTelegram.mockRestore();
    saveWhatsApp.mockRestore();
    restart.mockRestore();
    start.mockRestore();
    useActiveChatProfileStore.setState(previous);
  }
});

test("notification destinations stay isolated across logout, account, and organization switches", async () => {
  const orgA: UserOrgSummary = {
    createdAt: "2026-09-25T00:00:00Z",
    id: "org-a",
    name: "Organization A",
    role: "admin",
    slug: "organization-a",
    updatedAt: "2026-09-25T00:00:00Z",
  };
  const orgB: UserOrgSummary = {
    ...orgA,
    id: "org-b",
    name: "Organization B",
    slug: "organization-b",
  };
  const userA: AuthUserResponse = {
    activeOrgId: orgA.id,
    email: "user-a@example.com",
    id: "user-a",
    isPlatformAdmin: true,
    orgId: orgA.id,
  };
  const userB: AuthUserResponse = {
    ...userA,
    activeOrgId: orgA.id,
    email: "user-b@example.com",
    id: "user-b",
  };
  const destinationA: NotificationDestinationSummary = {
    channel: "telegram",
    createdAt: "2026-09-25T00:00:00Z",
    id: "destination-a",
    name: "Organization A alerts",
    telegram: { chatId: 1001, topicId: 11 },
    updatedAt: "2026-09-25T00:00:00Z",
    webhookPath: "/hooks/notification/destination-a",
  };
  let session = "user-a" as "user-a" | "user-b";
  let destinationRequest = "org-a" as "org-a" | "offline" | "pending";
  const pendingDestinations = Promise.withResolvers<
    ListNotificationDestinationsResponse
  >().promise;
  const defaultQueryOptions = appQueryClient.getDefaultOptions();
  appQueryClient.setDefaultOptions({
    ...defaultQueryOptions,
    queries: { ...defaultQueryOptions.queries, retry: false },
  });
  appQueryClient.clear();
  const getMe = spyOn(client, "getMe").mockImplementation(async () => {
    const user = session === "user-a" ? userA : userB;
    client.setOrgId(user.orgId ?? null);
    return user;
  });
  const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
    orgs: [orgA, orgB],
  });
  const login = spyOn(client, "login").mockImplementation(async () => {
    session = "user-b";
    return userB;
  });
  const logout = spyOn(client, "logout").mockImplementation(async () => {
    client.setOrgId(null);
  });
  const setActiveOrg = spyOn(client, "setActiveOrg").mockImplementation(
    async (orgId) => {
      const nextUser = { ...userB, activeOrgId: orgId, orgId };
      client.setOrgId(orgId);
      return nextUser;
    }
  );
  const listProfiles = spyOn(client, "listProfiles").mockResolvedValue({
    profiles: [],
  });
  const listDestinations = spyOn(
    client,
    "listNotificationDestinations"
  ).mockImplementation(() => {
    if (destinationRequest === "org-a") {
      return Promise.resolve({ destinations: [destinationA] });
    }
    if (destinationRequest === "offline") {
      return Promise.reject(new Error("offline"));
    }
    return pendingDestinations;
  });
  const rotate = spyOn(
    client,
    "regenerateNotificationDestinationKey"
  ).mockResolvedValue({
    apiKey: "secret-from-organization-a",
    destination: destinationA,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settle = () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 20);
    return promise;
  };

  function AuthActions() {
    const { login: loginUser, logout: logoutUser, switchOrg } = useAuth();
    return (
      <>
        <button
          onClick={() =>
            void loginUser("<anon_email_762ce49809b2fdf3>", "password")
          }
          type="button"
        >
          Log in test user
        </button>
        <button onClick={() => void logoutUser()} type="button">
          Log out test user
        </button>
        <button onClick={() => void switchOrg(orgB.id)} type="button">
          Switch test organization
        </button>
      </>
    );
  }

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={appQueryClient}>
          <AuthProvider>
            <NotificationDestinationsCard />
            <AuthActions />
          </AuthProvider>
        </QueryClientProvider>
      );
      await settle();
    });
    expect(container.textContent).toContain("Organization A alerts");

    const rotateButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Rotate key")
    );
    expect(rotateButton).not.toBeUndefined();
    await act(async () => {
      rotateButton?.click();
      await settle();
    });
    expect(container.textContent).toContain(
      "Latest webhook credentials ready"
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          "button:nth-of-type(2)"
        )
        ?.click();
      await settle();
    });
    expect(container.textContent).not.toContain("Organization A alerts");
    expect(container.textContent).not.toContain(
      "Latest webhook credentials ready"
    );
    expect(
      appQueryClient.getQueryData(
        queryKeys.notificationDestinations.all(userA.id, orgA.id)
      )
    ).toBeUndefined();

    destinationRequest = "offline";
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          "button:nth-of-type(1)"
        )
        ?.click();
      await settle();
    });
    expect(container.textContent).not.toContain("Organization A alerts");

    destinationRequest = "pending";
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          "button:nth-of-type(3)"
        )
        ?.click();
      await settle();
    });
    expect(setActiveOrg).toHaveBeenCalledWith(orgB.id);
    expect(container.textContent).not.toContain("Organization A alerts");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    appQueryClient.clear();
    appQueryClient.setDefaultOptions(defaultQueryOptions);
    client.setOrgId(null);
    getMe.mockRestore();
    listUserOrgs.mockRestore();
    login.mockRestore();
    logout.mockRestore();
    setActiveOrg.mockRestore();
    listProfiles.mockRestore();
    listDestinations.mockRestore();
    rotate.mockRestore();
  }
});
