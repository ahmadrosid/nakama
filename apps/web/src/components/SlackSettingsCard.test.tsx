import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  SlackSettingsResponse,
  SystemStatusResponse,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SlackSettingsCard } from "@/components/SlackSettingsCard";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ChannelProfileContext } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const ORG = "org-slack";
const AGENT = "agent-a";
const settingsKey = [...queryKeys.slack.settings, ORG, AGENT];
const statusKey = [...queryKeys.systemStatus, ORG, AGENT];

const savedSettings: SlackSettingsResponse = {
  allowedUserIds: ["U0MANUAL1"],
  allowWorkspace: false,
  appTokenMasked: "…app",
  botTokenMasked: "…bot",
  configured: true,
  handshakeCode: null,
  pairedUserIds: ["U0PAIRED1"],
  profileId: AGENT,
};

const auth = {
  activeOrg: {
    createdAt: "",
    id: ORG,
    name: "Slack org",
    role: "admin",
    slug: "slack-org",
    updatedAt: "",
  },
  isAuthenticated: true,
  isLoading: false,
  orgs: [],
  user: { email: "admin@example.com", id: "admin", isPlatformAdmin: false },
} as unknown as AuthContextValue;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function renderCard(slackWorker: SystemStatusResponse["slackWorker"]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(settingsKey, savedSettings);
  queryClient.setQueryData(statusKey, { slackWorker });
  const api = client.forOrg(ORG);
  const scope = spyOn(client, "forOrg").mockReturnValue(api);
  const fetchSettings = spyOn(api, "getSlackSettings").mockResolvedValue(
    savedSettings
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    scope.mockRestore();
    fetchSettings.mockRestore();
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>
          <ChannelProfileContext.Provider value={AGENT}>
            <SlackSettingsCard />
          </ChannelProfileContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
    await settle();
  });
  const badges = () =>
    [
      ...container.querySelectorAll('label[for="slack-allowed-users"] > span'),
    ].map((badge) => badge.textContent?.replace("paired", "").trim());
  return { badges, container, queryClient };
}

test("a paired member removed from the form stays removed when the card refreshes", async () => {
  const { badges, container, queryClient } = await renderCard({
    configured: true,
    connected: true,
    ok: true,
    paired: true,
    running: true,
  });
  expect(badges()).toEqual(["U0PAIRED1", "U0MANUAL1"]);

  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('[aria-label="Remove U0PAIRED1"]')
      ?.click();
    await settle();
  });
  expect(badges()).toEqual(["U0MANUAL1"]);

  // A refresh with nothing new must not bring the removed member back.
  await act(async () => {
    queryClient.setQueryData(settingsKey, { ...savedSettings });
    await settle();
  });
  expect(badges()).toEqual(["U0MANUAL1"]);

  // Someone who pairs meanwhile still shows up next to the unsaved edit.
  await act(async () => {
    queryClient.setQueryData(settingsKey, {
      ...savedSettings,
      pairedUserIds: ["U0PAIRED1", "U0NEWMEM1"],
    });
    await settle();
  });
  expect(badges()).toEqual(["U0MANUAL1", "U0NEWMEM1"]);
});

test("a running worker whose Slack socket is down is not shown as connected", async () => {
  const { container } = await renderCard({
    configured: true,
    connected: false,
    ok: true,
    paired: true,
    running: true,
  });
  const text = container.textContent ?? "";

  expect(text).toContain("Disconnected");
  expect(text).not.toMatch(/\bConnected\b/);
});
