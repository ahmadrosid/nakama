import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { WhatsAppSettingsCard } from "@/components/WhatsAppSettingsCard";
import { WhatsAppSettingsCardContent } from "@/components/whatsapp-settings-card-content";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ChannelProfileContext } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

function authContextForTest(
  activeOrg: AuthContextValue["activeOrg"]
): AuthContextValue {
  return {
    activeOrg,
    archiveOrg: async () => undefined,
    createOrg: async () => undefined,
    isAuthenticated: true,
    isLoading: false,
    login: async () => {
      throw new Error("Login is not used in this test.");
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
    user: null,
  };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function renderCard(
  overrides: Partial<ComponentProps<typeof WhatsAppSettingsCardContent>> = {}
) {
  const props: ComponentProps<typeof WhatsAppSettingsCardContent> = {
    actionLabel: "Connect WhatsApp",
    allowedPhoneSummary: "2 numbers",
    allowUnpairedGroupMembers: false,
    awaitingQr: false,
    bridgeStarting: false,
    canSave: false,
    configured: true,
    connected: true,
    copied: false,
    embedded: true,
    formError: null,
    linkedNumber: "+62***1234",
    linkingAfterScan: false,
    loadError: null,
    onAllowUnpairedGroupMembersChange: mock(),
    onCopyPairingCode: mock(),
    onManageAllowedPhones: mock(),
    onReconnect: mock(),
    onRegeneratePairingCode: mock(),
    onRequireGroupMentionChange: mock(),
    onSave: mock(),
    paired: true,
    pairingCode: null,
    qrCode: null,
    reconnectPending: false,
    regeneratePending: false,
    requireGroupMention: true,
    running: true,
    savePending: false,
    showQr: false,
    showReconnect: true,
    statusLine: "Saved",
    worker: { process: { managed: false } },
    ...overrides,
  };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContextForTest(null)}>
          <WhatsAppSettingsCardContent {...props} />
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  return { container, props };
}

function button(container: HTMLElement, label: string) {
  const result = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label
  );

  expect(result).toBeDefined();

  return result!;
}

for (const embedded of [true, false]) {
  test(`linked account shows management once (embedded=${embedded})`, () => {
    const { container, props } = renderCard({ embedded });
    expect(
      container.querySelector("ol[aria-label='WhatsApp setup progress']")
    ).toBeNull();
    expect(container.textContent).toContain("Connected");
    expect(container.textContent).toContain("+62***1234");
    expect(container.querySelectorAll("p[role='status']")).toHaveLength(1);
    const settings = container.querySelector("details.group");
    expect(settings?.hasAttribute("open")).toBe(false);
    act(() => button(container, "Edit").click());
    expect(props.onManageAllowedPhones).toHaveBeenCalledTimes(1);
  });
}

for (const running of [true, false]) {
  test(`linked offline account retains access and recovery (running=${running})`, () => {
    const { container } = renderCard({ connected: false, running });
    expect(container.textContent).toContain("Offline");
    expect(
      container.querySelector("ol[aria-label='WhatsApp setup progress']")
    ).toBeNull();
    expect(button(container, "Edit").disabled).toBe(false);
    expect(button(container, "Scan a new QR code").disabled).toBe(false);
  });
}

test("saved pairing code alone does not return a linked account to setup", () => {
  const { container, props } = renderCard({ pairingCode: "12345678" });
  expect(
    container.querySelector("ol[aria-label='WhatsApp setup progress']")
  ).toBeNull();
  act(() => button(container, "Copy").click());
  expect(props.onCopyPairingCode).toHaveBeenCalledTimes(1);
});

for (const state of [
  {
    canSave: true,
    configured: false,
    paired: false,
    running: false,
    step: "Start connection",
  },
  { paired: false, running: false, step: "Start connection" },
  { awaitingQr: true, paired: false, step: "Link account" },
  {
    bridgeStarting: true,
    paired: false,
    pairingCode: "12345678",
    step: "Link account",
  },
  { linkingAfterScan: true, paired: false, step: "Link account" },
  { paired: false, running: true, step: "Link account" },
  { paired: true, qrCode: "test-qr", showQr: true, step: "Link account" },
]) {
  test(`setup selects ${state.step}: ${JSON.stringify(state)}`, () => {
    const { step, ...overrides } = state;
    const { container } = renderCard(overrides);
    expect(
      container.querySelector("li[aria-current='step'] h2")?.textContent
    ).toBe(step);
    expect(container.querySelectorAll("p[role='status']")).toHaveLength(1);

    if (overrides.showQr) {
      expect(container.querySelector("svg")).not.toBeNull();
      expect(
        container.querySelector("ol[aria-label='Steps to connect WhatsApp']")
      ).not.toBeNull();
    }

    if (overrides.canSave) {
      expect(button(container, "Connect WhatsApp").disabled).toBe(false);
    }
  });
}

test("feedback remains outside collapsed settings and pending actions are disabled", () => {
  const { container } = renderCard({
    formError: "Request failed",
    pairingCode: "12345678",
    savePending: true,
    statusLine: "Request failed",
  });

  const alert = container.querySelector("[role='alert']");
  expect(alert).not.toBeNull();
  expect(alert?.closest("details")).toBeNull();
  expect(container.querySelectorAll("[role='alert']")).toHaveLength(1);
  expect(button(container, "Edit").disabled).toBe(true);
  expect(button(container, "New code").disabled).toBe(true);

  for (const control of container.querySelectorAll("[role='switch']")) {
    expect(control.hasAttribute("disabled")).toBe(true);
  }
});

test("group switches keep their save callbacks", () => {
  const { container, props } = renderCard();

  const switches =
    container.querySelectorAll<HTMLButtonElement>("[role='switch']");

  expect(switches).toHaveLength(2);
  act(() => switches[0]?.click());
  act(() => switches[1]?.click());
  expect(props.onRequireGroupMentionChange).toHaveBeenCalledWith(false);
  expect(props.onAllowUnpairedGroupMembersChange).toHaveBeenCalledWith(true);
});

for (const method of ["qr", "code"]) {
  test(`relink ${method} requires confirmation and permits cancellation`, async () => {
    const { container, props } = renderCard();

    const trigger = method === "qr" ? "Scan a new QR code" : "New code";

    act(() => button(container, trigger).click());
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(props.onReconnect).not.toHaveBeenCalled();
    expect(props.onRegeneratePairingCode).not.toHaveBeenCalled();
    act(() => button(dialog!, "Cancel").click());
    expect(props.onReconnect).not.toHaveBeenCalled();
    expect(props.onRegeneratePairingCode).not.toHaveBeenCalled();
    act(() => button(container, trigger).click());
    await act(async () =>
      button(
        document.querySelector<HTMLElement>("[role='dialog']")!,
        "Relink WhatsApp"
      ).click()
    );
    expect(props.onReconnect).toHaveBeenCalledTimes(method === "qr" ? 1 : 0);
    expect(props.onRegeneratePairingCode).toHaveBeenCalledTimes(
      method === "code" ? 1 : 0
    );
  });
}

test("card Edit opens allowed numbers for the selected profile", () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  queryClient.setQueryData(
    [...queryKeys.whatsapp.settings, null, "profile-a"],
    {
      allowedPhoneDetails: {},
      allowedPhones: ["62812345678"],
      allowUnpairedGroupMembers: false,
      configured: true,
      pairedJid: "62812345678@s.whatsapp.net",
      profileId: "profile-a",
      requireGroupMention: true,
    }
  );
  queryClient.setQueryData([...queryKeys.systemStatus, null, "profile-a"], {
    whatsappWorker: { connected: true, paired: true, running: true },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContextForTest(null)}>
          <ChannelProfileContext.Provider value="profile-a">
            <WhatsAppSettingsCard embedded />
          </ChannelProfileContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  );
  act(() => button(container, "Edit").click());
  const dialog = document.querySelector("[role='dialog']");
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain("+62812345678");
});

test("setup starts the existing WhatsApp worker", async () => {
  const api = client.forOrg(null);
  const scope = spyOn(client, "forOrg").mockReturnValue(api);
  cleanups.push(() => scope.mockRestore());

  const start = spyOn(api, "startWorker").mockResolvedValue({
    ok: true,
  });

  cleanups.push(() => start.mockRestore());

  const { container } = renderCard({
    connected: false,
    paired: false,
    running: false,
    worker: { process: { managed: true } },
  });

  await act(async () => {
    button(container, "Start connection").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(start).toHaveBeenCalledWith("whatsapp", undefined);
});

test("first connection uses the existing save handler", () => {
  const { container, props } = renderCard({
    canSave: true,
    configured: false,
    connected: false,
    paired: false,
    running: false,
  });

  act(() => button(container, "Connect WhatsApp").click());
  expect(props.onSave).toHaveBeenCalledTimes(1);
});
