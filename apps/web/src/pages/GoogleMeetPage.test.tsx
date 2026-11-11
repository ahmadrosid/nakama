import { afterEach, expect, spyOn, test } from "bun:test";
import { NakamaApiError } from "@nakama/core/api-error";
import type {
  MeetAction,
  MeetActionInput,
  MeetActionResults,
  MeetExtensionKey,
  Meeting,
  MeetOverview,
} from "@nakama/core/google-meet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { GoogleMeetPage } from "./GoogleMeetPage";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function meeting(overrides: Partial<Meeting>): Meeting {
  return {
    actorId: "admin",
    createdAt: 1000,
    durationMinutes: 60,
    error: null,
    id: "meeting",
    profileId: null,
    state: "finished",
    stopRequested: 0,
    transcriptFile: "transcript.md",
    updatedAt: 61_000,
    url: "https://meet.google.com/abc-defg-hij",
    ...overrides,
  };
}

const meetings = [
  meeting({ id: "live", state: "recording", title: "Live sync" }),
  meeting({ id: "design", title: "Design review" }),
  meeting({ id: "acme", title: "Customer call" }),
];

// SAFETY: GoogleMeetPage reads only activeOrg and user from the auth context.
const auth = {
  activeOrg: {
    createdAt: "",
    id: "org-a",
    name: "A",
    role: "admin",
    slug: "a",
    updatedAt: "",
  },
  user: { email: "admin@example.com", id: "admin", isPlatformAdmin: false },
} as AuthContextValue;

type Handlers = {
  [Action in MeetAction]?: (
    input?: MeetActionInput
  ) => Promise<MeetActionResults[Action]>;
};

async function mountPage(
  recordings?: MeetActionResults["recordings"],
  overview: () => Partial<MeetOverview> = () => ({}),
  {
    handlers = {},
    path = "/google-meet",
  }: { handlers?: Handlers; path?: string } = {}
) {
  // SAFETY: each branch returns the result shape of the action it handles.
  const invoke = spyOn(client, "invokeGoogleMeet").mockImplementation(((
    action: MeetAction,
    input?: MeetActionInput
  ) => {
    const handler = handlers[action];

    if (handler) {
      return handler(input);
    }

    if (action === "extension-keys") {
      return Promise.resolve({ keys: [] });
    }

    if (action === "meetings") {
      return Promise.resolve({
        canConfigure: true,
        captureProtocol: 1,
        configured: true,
        enabled: true,
        liveReady: true,
        meetings,
        transcription: null,
        transcriptionError: null,
        ...overview(),
      });
    }

    if (action === "transcript") {
      return Promise.resolve({
        meeting: meetings[0],
        nextCursor: 3,
        segments:
          input?.after === 0
            ? ["first", "second", "third"].map((text, sequence) => ({
                id: text,
                receivedAt: 0,
                sequence,
                speakerName: "Dina",
                text,
              }))
            : [],
      });
    }

    if (action === "recordings") {
      return Promise.resolve(recordings);
    }

    return Promise.resolve(meetings[0]);
  }) as typeof client.invokeGoogleMeet);

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <AuthContext.Provider value={auth}>
            <GoogleMeetPage />
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await Bun.sleep(20);
  });

  cleanups.push(async () => {
    invoke.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  return { container, invoke };
}

async function type(input: HTMLInputElement | null, value: string) {
  await act(async () => {
    const view = input?.ownerDocument.defaultView;

    if (input && view) {
      Object.getOwnPropertyDescriptor(
        view.HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, value);
      input.dispatchEvent(new view.Event("input", { bubbles: true }));
    }
  });
}

test("a recording meeting shows its latest lines and can be stopped", async () => {
  const { container, invoke } = await mountPage();
  const preview = container.querySelector(".meet-live-preview");

  expect(preview?.textContent).toContain("third");
  expect(preview?.textContent).toContain("second");
  expect(preview?.textContent).not.toContain("first");

  const stop = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Stop")
  );

  await act(async () => {
    stop?.click();
    await Bun.sleep(10);
  });

  expect(invoke).toHaveBeenCalledWith(
    "leave",
    { meetingId: "live" },
    "org-a",
    expect.anything()
  );
});

test("history lists only finished meetings and filters by search", async () => {
  const { container } = await mountPage();

  const rows = () =>
    [...container.querySelectorAll(".meet-list .meet-meeting")].map(
      (row) => row.querySelector(".meet-meeting-title")?.textContent
    );

  expect(rows()).toEqual(["Design review", "Customer call"]);

  const search = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search meetings"]'
  );

  await type(search, "acme call");

  expect(rows()).toEqual([]);

  await type(search, "customer");

  expect(rows()).toEqual(["Customer call"]);
});

test("recording picker imports the selected recording", async () => {
  const { container, invoke } = await mountPage({
    composioConfigured: true,
    driveConnected: true,
    gmailConnected: true,
    recordings: [
      {
        date: "2026-10-16",
        fileId: "first",
        messageId: "one",
        name: "First.mp4",
        size: 100,
      },
      {
        date: "2026-10-17",
        fileId: "second",
        messageId: "two",
        name: "Second.mp4",
        size: 200,
      },
    ],
  });

  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Import recording"))
      ?.click();
    await Bun.sleep(10);
  });

  const choices = [
    ...document.querySelectorAll<HTMLInputElement>('input[name="recording"]'),
  ];

  expect(choices).toHaveLength(2);
  expect(choices[0]?.checked).toBe(true);

  await act(async () => choices[1]?.click());
  expect(choices[1]?.checked).toBe(true);

  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Import")
      ?.click();
    await Bun.sleep(10);
  });

  expect(invoke).toHaveBeenCalledWith(
    "import-recording",
    { fileId: "second", messageId: "two" },
    "org-a",
    expect.anything()
  );
});

function button(container: HTMLElement, label: string) {
  return [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label
  );
}

test("an admin connects OpenRouter from the page and sees it connected", async () => {
  let connected = false;

  const check = spyOn(client, "checkProviderKey").mockResolvedValue({
    status: "ok",
  });

  // SAFETY: the page reads only the provider id from these responses.
  const provider = {
    id: "p-router",
    label: "OpenRouter",
    type: "openrouter",
  } as Awaited<ReturnType<typeof client.createProvider>>["provider"];

  const create = spyOn(client, "createProvider").mockResolvedValue({
    defaultProviderId: "p-router",
    initialModel: "",
    provider,
  });

  // SAFETY: the page reads only the provider id from this response.
  const secret = spyOn(client, "setProviderSecret").mockResolvedValue({
    provider,
  } as Awaited<ReturnType<typeof client.setProviderSecret>>);

  const select = spyOn(client, "setTranscriptionSettings").mockImplementation(
    async (model) => {
      connected = true;

      return { model };
    }
  );

  // Only models that take audio can transcribe.
  const catalog = spyOn(client, "getExternalModelCatalog").mockResolvedValue({
    data: [
      {
        architecture: { input_modalities: ["text"] },
        id: "acme/text-only",
        name: "Text only",
      },
      {
        architecture: { input_modalities: ["text", "audio"] },
        id: "openrouter/auto",
        name: "Auto Router",
      },
      {
        architecture: { input_modalities: ["text", "audio"] },
        id: "google/gemini-3.5-flash:batch",
        name: "Gemini batch",
      },
      {
        architecture: { input_modalities: ["text", "audio"] },
        id: "openai/gpt-4o-audio-preview",
        name: "GPT-4o Audio",
      },
    ],
  });

  cleanups.push(async () => {
    for (const spy of [catalog, check, create, secret, select]) {
      spy.mockRestore();
    }
  });

  const { container } = await mountPage(undefined, () =>
    connected
      ? {
          liveReady: false,
          transcription: {
            model: "openai/gpt-4o-audio-preview",
            type: "openrouter",
          },
        }
      : { configured: false, liveReady: false }
  );

  await act(async () => {
    button(container, "OpenRouter")?.click();
    await Bun.sleep(20);
  });
  await type(
    container.querySelector<HTMLInputElement>('input[type="password"]'),
    "sk-or-v1-key"
  );
  await act(async () => {
    button(container, "Save and test")?.click();
    await Bun.sleep(20);
  });

  expect(check).toHaveBeenCalledWith({
    apiKey: "sk-or-v1-key",
    baseUrl: undefined,
    type: "openrouter",
  });
  expect(create.mock.calls[0]?.[0]).toMatchObject({ type: "openrouter" });
  expect(secret).toHaveBeenCalledWith("p-router", "sk-or-v1-key");
  expect(select).toHaveBeenCalledWith("p-router::openai/gpt-4o-audio-preview");
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(container.textContent).toContain("openai/gpt-4o-audio-preview");
  expect(button(container, "Change")).toBeDefined();
});

test("a rejected key stays on the form and adds no provider", async () => {
  const check = spyOn(client, "checkProviderKey").mockResolvedValue({
    status: "rejected",
  });

  const create = spyOn(client, "createProvider");

  cleanups.push(async () => {
    check.mockRestore();
    create.mockRestore();
  });

  const { container } = await mountPage(undefined, () => ({
    configured: false,
  }));

  await type(
    container.querySelector<HTMLInputElement>('input[type="password"]'),
    "sk-bad"
  );
  await act(async () => {
    button(container, "Save and test")?.click();
    await Bun.sleep(20);
  });

  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(create).not.toHaveBeenCalled();
  expect(container.querySelector('input[type="password"]')).not.toBeNull();
});

test("a self-hosted provider is saved with a name and its base URL", async () => {
  const check = spyOn(client, "checkProviderKey").mockResolvedValue({
    status: "unchecked",
  });

  // SAFETY: the page reads only the provider id from this response.
  const provider = {
    id: "p-local",
    type: "openai_compatible",
  } as Awaited<ReturnType<typeof client.createProvider>>["provider"];

  const create = spyOn(client, "createProvider").mockResolvedValue({
    defaultProviderId: "p-other",
    initialModel: "",
    provider,
  });

  const select = spyOn(client, "setTranscriptionSettings").mockResolvedValue({
    model: "p-local::whisper-large-v3",
  });

  cleanups.push(async () => {
    for (const spy of [check, create, select]) {
      spy.mockRestore();
    }
  });

  const { container } = await mountPage(undefined, () => ({
    configured: false,
  }));

  await act(async () => button(container, "Self-hosted")?.click());
  await type(
    container.querySelector<HTMLInputElement>('input[type="url"]'),
    "http://127.0.0.1:8000/v1"
  );
  await type(
    container.querySelector<HTMLInputElement>('input[placeholder="whisper-1"]'),
    "whisper-large-v3"
  );
  await act(async () => {
    button(container, "Save and test")?.click();
    await Bun.sleep(20);
  });

  expect(create.mock.calls[0]?.[0]).toMatchObject({
    baseUrl: "http://127.0.0.1:8000/v1",
    customModels: [{ id: "whisper-large-v3" }],
    type: "openai_compatible",
  });
  expect(create.mock.calls[0]?.[0].label?.trim()).toBeTruthy();
  expect(select).toHaveBeenCalledWith("p-local::whisper-large-v3");
});

function calls(invoke: { mock: { calls: unknown[][] } }, action: MeetAction) {
  return invoke.mock.calls.filter((call) => call[0] === action);
}

const browserKey: MeetExtensionKey = {
  createdAt: 1000,
  expiresAt: 9_000_000_000_000,
  id: "key-1",
  label: "Chrome on macOS",
  lastUsedAt: null,
};

test("a pairing code is approved only after the member clicks Approve", async () => {
  const { container, invoke } = await mountPage(undefined, undefined, {
    handlers: { "approve-extension": () => Promise.resolve(browserKey) },
    path: "/google-meet?pair=k7q-4m2",
  });

  expect(calls(invoke, "approve-extension")).toEqual([]);

  await act(async () => {
    button(container, "Approve")?.click();
    await Bun.sleep(20);
  });

  expect(invoke).toHaveBeenCalledWith(
    "approve-extension",
    { code: "K7Q-4M2" },
    "org-a",
    expect.anything()
  );
  expect(button(container, "Approve")).toBeUndefined();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  // The list reloads so the new browser shows up.
  expect(calls(invoke, "extension-keys").length).toBe(2);
});

test("a failed approval keeps the card and shows an error", async () => {
  const { container, invoke } = await mountPage(undefined, undefined, {
    handlers: {
      "approve-extension": () =>
        Promise.reject(
          new NakamaApiError("This code is wrong or has expired", 400)
        ),
    },
    path: "/google-meet?pair=K7Q4M2",
  });

  await act(async () => {
    button(container, "Approve")?.click();
    await Bun.sleep(20);
  });

  expect(calls(invoke, "approve-extension").length).toBe(1);
  expect(button(container, "Approve")).not.toBeUndefined();
  expect(
    container.querySelector('[aria-label="Connect browser"] [role="alert"]')
  ).not.toBeNull();
});

test("a malformed pairing code sends no request", async () => {
  const { container, invoke } = await mountPage(undefined, undefined, {
    path: "/google-meet?pair=0OI-1LU",
  });

  await act(async () => {
    button(container, "Approve")?.click();
    await Bun.sleep(20);
  });

  expect(calls(invoke, "approve-extension")).toEqual([]);
  expect(
    container.querySelector('[aria-label="Connect browser"] [role="alert"]')
  ).not.toBeNull();
});

test("Remove revokes the browser key and reloads the list", async () => {
  let keys = [
    browserKey,
    { ...browserKey, id: "key-2", label: "Chrome on Windows" },
  ];

  const { container, invoke } = await mountPage(undefined, undefined, {
    handlers: {
      "extension-keys": () => Promise.resolve({ keys }),
      "revoke-extension": (input) => {
        keys = keys.filter((key) => key.id !== input?.keyId);

        return Promise.resolve({ revoked: true });
      },
    },
  });

  const rows = () =>
    [...container.querySelectorAll(".meet-key .meet-meeting-title")].map(
      (row) => row.textContent
    );

  expect(rows()).toEqual(["Chrome on macOS", "Chrome on Windows"]);

  await act(async () => {
    container
      .querySelectorAll<HTMLButtonElement>(".meet-key button")[1]
      ?.click();
    await Bun.sleep(20);
  });

  expect(invoke).toHaveBeenCalledWith(
    "revoke-extension",
    { keyId: "key-2" },
    "org-a",
    expect.anything()
  );
  expect(rows()).toEqual(["Chrome on macOS"]);
});

test("connected browsers are not loaded while Meet is disabled", async () => {
  const { invoke } = await mountPage(undefined, () => ({ enabled: false }));

  expect(calls(invoke, "extension-keys")).toEqual([]);
});

test("the status follows the browser keys, not an open tab", async () => {
  let keys = [browserKey];

  const { container } = await mountPage(undefined, undefined, {
    handlers: {
      "extension-keys": () => Promise.resolve({ keys }),
      "revoke-extension": () => {
        keys = [];

        return Promise.resolve({ revoked: true });
      },
    },
  });

  const status = () => container.querySelector(".meet-connection")?.textContent;

  const setup = () =>
    container.querySelector('[aria-label="Live capture setup"]');

  expect(status()).toBe("Extension connected");
  expect(setup()).toBeNull();

  await act(async () => {
    container.querySelector<HTMLButtonElement>(".meet-key button")?.click();
    await Bun.sleep(20);
  });

  expect(status()).toBe("Extension not connected");
  expect(setup()).not.toBeNull();
});

test("the page listens for no window messages from an extension", async () => {
  const listen = spyOn(window, "addEventListener");

  try {
    await mountPage();
    expect(listen.mock.calls.map(([type]) => type)).not.toContain("message");
  } finally {
    listen.mockRestore();
  }
});
