import { afterEach, expect, spyOn, test } from "bun:test";
import { NakamaApiError } from "@nakama/core/api-error";
import { COMPOSIO_CUSTOM_AUTH_REQUIRED } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { VirtuosoMockContext } from "react-virtuoso";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ThemeProvider } from "@/context/theme-context";
import { client } from "@/lib/client";

const cleanups: Array<() => Promise<void>> = [];

// Last in, first out: unmount the card before its client spies are restored.
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const NO_MANAGED_AUTH = new NakamaApiError(
  "Composio has no managed auth for Google Forms.",
  422,
  "/v1/composio/toolkits/googleforms/connect",
  undefined,
  { code: COMPOSIO_CUSTOM_AUTH_REQUIRED }
);

function authFor(role: "admin" | "member") {
  // SAFETY: the connect card reads only activeOrg and user from the auth context.
  return {
    activeOrg: {
      createdAt: "",
      id: "org-a",
      name: "A",
      role,
      slug: "a",
      updatedAt: "",
    },
    user: { email: "u@example.com", id: "u", isPlatformAdmin: false },
  } as AuthContextValue;
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50 && !check(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  expect(check()).toBe(true);
}

function mockToolkits() {
  return spyOn(client, "listComposioToolkits").mockResolvedValue({
    catalog: [
      {
        description: null,
        logoUrl: null,
        name: "Google Forms",
        slug: "googleforms",
      },
    ],
    catalogError: null,
    composioAvailable: true,
    composioReachable: true,
    configured: true,
    orgToolkits: [
      {
        cachedTools: [],
        displayName: "Google Forms",
        id: "tk-1",
        lastError: null,
        status: "enabled",
        toolkitSlug: "googleforms",
        updatedAt: "",
      },
    ],
    userConnections: [],
  });
}

async function renderCard({
  messages,
  onAgent,
  profileId,
  role,
}: {
  messages?: ComponentProps<typeof ChatMessageList>["messages"];
  onAgent: boolean;
  profileId?: string;
  role: "admin" | "member";
}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <ThemeProvider>
            <AuthContext.Provider value={authFor(role)}>
              <VirtuosoMockContext.Provider
                value={{ itemHeight: 100, viewportHeight: 2000 }}
              >
                <ChatMessageList
                  messages={
                    messages ?? [
                      {
                        content: "Create a Google Form",
                        id: "u1",
                        role: "user",
                      },
                      {
                        content: "",
                        id: "t1",
                        role: "tool",
                        tool: "composio__connect_account",
                        toolCallId: "call-1",
                        toolResult: {
                          displayName: "Googleforms",
                          onAgent,
                          toolkitSlug: "googleforms",
                          type: "composio_connect",
                        },
                      },
                      {
                        content: "Connect Google Forms.",
                        id: "a1",
                        role: "assistant",
                      },
                    ]
                  }
                  profileId={profileId}
                  sessionId="s1"
                />
              </VirtuosoMockContext.Provider>
            </AuthContext.Provider>
          </ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  return {
    connect: () =>
      [...container.querySelectorAll("button")].find(
        (item) => item.textContent === "Connect"
      ),
    container,
    status: () => container.querySelector('[role="status"]'),
  };
}

function restoreLater(spies: Array<{ mockRestore: () => void }>) {
  cleanups.push(async () => {
    for (const spy of spies) {
      spy.mockRestore();
    }
  });
}

async function clickConnect(role: "admin" | "member") {
  restoreLater([
    mockToolkits(),
    spyOn(client, "connectComposioToolkit").mockRejectedValue(NO_MANAGED_AUTH),
    spyOn(window, "open").mockReturnValue(null),
  ]);

  const card = await renderCard({ onAgent: true, role });

  await waitFor(() => card.connect()?.disabled === false);

  await act(async () => {
    card.connect()?.click();
  });

  await waitFor(() => card.status() !== null);

  return card.container;
}

/** A member opens a chat with a shared agent they cannot read. */
async function renderSharedAgentCard(onAgent: boolean) {
  const getProfile = spyOn(client, "getProfile").mockRejectedValue(
    new NakamaApiError("Forbidden", 403, "/v1/profiles/p-shared")
  );

  restoreLater([mockToolkits(), getProfile]);

  const card = await renderCard({
    onAgent,
    profileId: "p-shared",
    role: "member",
  });

  await waitFor(() => getProfile.mock.calls.length === 1);

  return card;
}

test("an admin sees custom auth steps", async () => {
  const container = await clickConnect("admin");

  expect(container.querySelector('[role="status"] ol')).not.toBeNull();
  expect(
    [...container.querySelectorAll("a")].some((link) =>
      link.href.includes("custom-auth-configs")
    )
  ).toBe(true);
});

test("an image URL keeps its model-generated description visible", async () => {
  const description = "A red boat beside a pier";

  const card = await renderCard({
    messages: [
      {
        content: "Check this image",
        id: "image-user",
        imageAttachments: [
          {
            description,
            mediaType: "image/png",
            url: "data:image/png;base64,aW1hZ2U=",
          },
        ],
        role: "user",
      },
    ],
    onAgent: true,
    role: "admin",
  });

  expect(
    card.container.querySelector('[aria-label="Preview Image 1"]')
  ).not.toBeNull();
  expect(card.container.textContent).toContain(description);
});

test("a member gets guidance but not the admin setup steps", async () => {
  const container = await clickConnect("member");
  const status = container.querySelector('[role="status"]');

  expect(status?.querySelector("ol")).toBeNull();
  expect(
    [...container.querySelectorAll("a")].some((link) =>
      link.href.includes("custom-auth-configs")
    )
  ).toBe(false);
  expect(status?.textContent).not.toBe(NO_MANAGED_AUTH.message);
  expect(status?.textContent?.trim()).not.toBe("");
});

test("a member can connect an app that is on a shared agent", async () => {
  const card = await renderSharedAgentCard(true);

  await waitFor(() => card.connect()?.disabled === false);
  expect(card.status()).toBeNull();
});

test("a member sees why an app not on a shared agent is blocked", async () => {
  const card = await renderSharedAgentCard(false);

  await waitFor(() => Boolean(card.status()?.textContent?.trim()));
  expect(card.connect()?.disabled).toBe(true);
});
