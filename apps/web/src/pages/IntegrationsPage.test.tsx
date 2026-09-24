import { expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { WhatsAppSettingsCard } from "@/components/WhatsAppSettingsCard";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ChannelProfileContext } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
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
