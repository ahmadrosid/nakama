import { afterEach, expect, spyOn, test } from "bun:test";
import type { TeamsSettingsResponse } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TeamsSettingsCard } from "@/components/TeamsSettingsCard";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ChannelProfileContext } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { buildProfileChannels } from "@/pages/profiles/profile-channels";

const TENANT = "33333333-3333-4333-8333-333333333333";

const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

const USER = "11111111-1111-4111-8111-111111111111";

function settings(
  patch: Partial<TeamsSettingsResponse> = {}
): TeamsSettingsResponse {
  return {
    allowedUserIds: [],
    clientId: null,
    clientSecretConfigured: false,
    configured: false,
    handshakeCode: null,
    handshakeExpiresAt: null,
    messagingEndpoint:
      "https://nakama.example.com/v1/channels/teams/profile-a/messages",
    pairedUserIds: [],
    profileId: "profile-a",
    tenantId: null,
    ...patch,
  };
}

function authContextForTest(): AuthContextValue {
  return {
    activeOrg: null,
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
    user: { email: "admin@example.com", id: "admin", isPlatformAdmin: true },
  };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function stubApi(loaded: TeamsSettingsResponse) {
  const api = client.forOrg(null);
  const scope = spyOn(client, "forOrg").mockReturnValue(api);
  const get = spyOn(api, "getTeamsSettings").mockResolvedValue(loaded);

  const save = spyOn(api, "setTeamsSettings").mockResolvedValue(
    settings({ clientSecretConfigured: true, configured: true })
  );

  const status = spyOn(api, "getSystemStatus").mockRejectedValue(
    new Error("not needed")
  );

  const generate = spyOn(api, "regenerateTeamsHandshake").mockResolvedValue({
    ...loaded,
    configured: true,
    handshakeCode: "A".repeat(32),
    handshakeExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  });

  cleanups.push(() => {
    scope.mockRestore();
    get.mockRestore();
    save.mockRestore();
    status.mockRestore();
    generate.mockRestore();
  });

  return { api, generate, save };
}

async function renderCard(auth = authContextForTest()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>
          <ChannelProfileContext.Provider value="profile-a">
            <TeamsSettingsCard />
          </ChannelProfileContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  });

  // The settings query resolves after the first render; wait for the form.
  await act(async () => {
    const deadline = Date.now() + 2000;

    while (!container.querySelector("input") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });

  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  return container;
}

async function typeInto(container: HTMLElement, label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(
    `input[aria-label='${label}']`
  );

  expect(input).not.toBeNull();

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, value);
    input?.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label
  );

  expect(button).toBeDefined();

  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

test("saves the entered credentials to the selected agent", async () => {
  const { save } = stubApi(settings());
  const container = await renderCard();

  await typeInto(container, "Tenant ID", TENANT);
  await typeInto(container, "Client ID", CLIENT_ID);
  await typeInto(container, "Client secret", "new-secret");
  await typeInto(container, "Allowed users", USER);
  await clickButton(container, "Save");

  expect(save).toHaveBeenCalledWith(
    {
      allowedUserIds: USER,
      clientId: CLIENT_ID,
      clientSecret: "new-secret",
      tenantId: TENANT,
    },
    "profile-a"
  );
});

test("generates a code for the selected agent and copies the returned code", async () => {
  const { generate } = stubApi(settings({ configured: true }));
  const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  cleanups.push(() => copy.mockRestore());
  const container = await renderCard();
  await clickButton(container, "Generate code");
  expect(generate).toHaveBeenCalledWith("profile-a");
  expect(
    container.querySelector("code[aria-label='Pairing code']")?.textContent
  ).toBe("A".repeat(32));
  await clickButton(container, "Copy");
  expect(copy).toHaveBeenCalledWith("A".repeat(32));
});

test("generating a code preserves unsaved credential edits", async () => {
  stubApi(
    settings({ clientId: CLIENT_ID, configured: true, tenantId: TENANT })
  );
  const container = await renderCard();
  await typeInto(container, "Client secret", "unsaved-secret");
  await typeInto(container, "Allowed users", USER);
  await clickButton(container, "Generate code");
  expect(
    container.querySelector<HTMLInputElement>(
      "input[aria-label='Client secret']"
    )?.value
  ).toBe("unsaved-secret");
  expect(
    container.querySelector<HTMLInputElement>(
      "input[aria-label='Allowed users']"
    )?.value
  ).toBe(USER);
});

test("after saving, the form shows the ids the server stored", async () => {
  const stored = "aaaabbbb-cccc-4ddd-8eee-ffff00001111";

  const loaded = settings({
    allowedUserIds: [stored],
    clientId: CLIENT_ID,
    clientSecretConfigured: true,
    configured: true,
    tenantId: TENANT,
  });

  const { save } = stubApi(loaded);
  save.mockResolvedValue(loaded);
  const container = await renderCard();

  await typeInto(container, "Allowed users", stored.toUpperCase());
  await clickButton(container, "Save");

  expect(
    container.querySelector<HTMLInputElement>(
      "input[aria-label='Allowed users']"
    )?.value
  ).toBe(stored);
});

test("a failed code request leaves the form available and displays an error", async () => {
  const { generate } = stubApi(settings({ configured: true }));
  generate.mockRejectedValue(new Error("unavailable"));
  const container = await renderCard();
  await clickButton(container, "Generate code");
  expect(container.querySelector("[role='alert']")).not.toBeNull();
  expect(container.querySelector("code[aria-label='Pairing code']")).toBeNull();
});

test("code generation stays disabled until credentials are saved", async () => {
  const { generate } = stubApi(settings());
  const container = await renderCard();

  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === "Generate code"
  );

  expect(button?.disabled).toBe(true);
  button?.click();
  expect(generate).not.toHaveBeenCalled();
});

test("members have no pairing code controls", async () => {
  stubApi(settings({ configured: true }));
  const auth = authContextForTest();
  auth.user = {
    email: "member@example.com",
    id: "member",
    isPlatformAdmin: false,
  };
  const container = await renderCard(auth);
  expect(
    Array.from(container.querySelectorAll("button")).some((button) =>
      button.textContent?.includes("code")
    )
  ).toBe(false);
});

test("an expired code is not available to copy", async () => {
  stubApi(
    settings({
      configured: true,
      handshakeCode: "A".repeat(32),
      handshakeExpiresAt: "2000-01-01T00:00:00.000Z",
    })
  );
  const container = await renderCard();
  expect(container.querySelector("code[aria-label='Pairing code']")).toBeNull();
  expect(
    Array.from(container.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "Copy"
    )
  ).toBe(false);
});

test("never fills the saved secret back in, and keeps it when left blank", async () => {
  const { save } = stubApi(
    settings({
      allowedUserIds: [USER],
      clientId: CLIENT_ID,
      clientSecretConfigured: true,
      configured: true,
      tenantId: TENANT,
    })
  );

  const container = await renderCard();

  const secret = container.querySelector<HTMLInputElement>(
    "input[aria-label='Client secret']"
  );

  expect(secret?.value).toBe("");

  await clickButton(container, "Save");

  const [request] = save.mock.calls[0] ?? [];

  expect(request).not.toHaveProperty("clientSecret");
});

test("shows a credential failure without echoing the secret", async () => {
  const { save } = stubApi(settings());

  save.mockRejectedValue(
    new Error("Teams credentials could not be validated.")
  );

  const container = await renderCard();

  await typeInto(container, "Tenant ID", TENANT);
  await typeInto(container, "Client ID", CLIENT_ID);
  await typeInto(container, "Client secret", "typed-secret-value");
  await clickButton(container, "Save");

  expect(container.querySelector("[role='alert']")).not.toBeNull();
  expect(container.textContent).not.toContain("typed-secret-value");
});

test("warns instead of showing an endpoint when there is no https public URL", async () => {
  stubApi(settings({ messagingEndpoint: null }));
  const container = await renderCard();

  expect(container.querySelector("[role='alert']")).not.toBeNull();
  expect(container.querySelector("code")).toBeNull();
});

test("shows the messaging endpoint to register with the bot", async () => {
  stubApi(settings());
  const container = await renderCard();

  expect(container.textContent).toContain(
    "https://nakama.example.com/v1/channels/teams/profile-a/messages"
  );
});

test("a running worker is listed as listening, not as connected to Teams", () => {
  const { channels } = buildProfileChannels(
    {
      teamsWorker: {
        configured: true,
        connected: true,
        ok: true,
        paired: true,
        running: true,
      },
    },
    false,
    false
  );

  const teams = channels.find((channel) => channel.id === "teams");

  expect(teams?.name).toBe("Microsoft Teams");
  expect(teams?.statusLabel).toBe("Listening locally");
  expect(teams?.connected).toBe(false);
});

// Stop asks for confirmation in a dialog rendered outside the card.
for (const [label, running, method, confirms] of [
  ["Start", false, "startWorker", false],
  ["Stop", true, "stopWorker", true],
] as const) {
  test(`${label} controls the Teams worker of the selected agent`, async () => {
    const { api } = stubApi(
      settings({ clientSecretConfigured: true, configured: true })
    );

    // SAFETY: The card reads only teamsWorker from the status response.
    const status = spyOn(api, "getSystemStatus").mockResolvedValue({
      teamsWorker: {
        configured: true,
        connected: false,
        ok: true,
        paired: true,
        process: { managed: true },
        running,
      },
    } as never);

    const control = spyOn(api, method).mockResolvedValue({ ok: true });

    cleanups.push(() => {
      status.mockRestore();
      control.mockRestore();
    });

    const container = await renderCard();

    await act(async () => {
      const deadline = Date.now() + 2000;

      while (
        !Array.from(container.querySelectorAll("button")).some(
          (item) => item.textContent?.trim() === label && !item.disabled
        ) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });

    await clickButton(container, label);

    if (confirms) {
      await act(async () => {
        const deadline = Date.now() + 2000;

        while (
          !document.querySelector("[role='dialog']") &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      });

      const dialog = document.querySelector<HTMLElement>("[role='dialog']");

      expect(dialog).not.toBeNull();

      if (dialog) {
        await clickButton(dialog, label);
      }
    }

    expect(control).toHaveBeenCalledWith("teams", "profile-a");
  });
}
