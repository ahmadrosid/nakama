import { afterEach, expect, spyOn, test } from "bun:test";
import { NakamaApiError } from "@nakama/core/api-error";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
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

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

// SAFETY: the connect card reads only activeOrg and user from the auth context.
const MEMBER = {
  activeOrg: {
    createdAt: "",
    id: "org-a",
    name: "A",
    role: "member",
    slug: "a",
    updatedAt: "",
  },
  user: { email: "u@example.com", id: "u", isPlatformAdmin: false },
} as AuthContextValue;

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50 && !check(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  expect(check()).toBe(true);
}

/** A member opens a chat with a shared agent they cannot read. */
async function renderSharedAgentCard(onAgent: boolean) {
  const spies = [
    spyOn(client, "listComposioToolkits").mockResolvedValue({
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
    }),
    spyOn(client, "getProfile").mockRejectedValue(
      new NakamaApiError("Forbidden", 403, "/v1/profiles/p-shared")
    ),
  ];

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();

    for (const spy of spies) {
      spy.mockRestore();
    }
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
            <AuthContext.Provider value={MEMBER}>
              <VirtuosoMockContext.Provider
                value={{ itemHeight: 100, viewportHeight: 2000 }}
              >
                <ChatMessageList
                  messages={[
                    { content: "Create a Google Form", id: "u1", role: "user" },
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
                  ]}
                  profileId="p-shared"
                  sessionId="s1"
                />
              </VirtuosoMockContext.Provider>
            </AuthContext.Provider>
          </ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const getProfile = spies[1];
  await waitFor(() => getProfile?.mock.calls.length === 1);

  return {
    connect: () =>
      [...container.querySelectorAll("button")].find(
        (item) => item.textContent === "Connect"
      ),
    status: () => container.querySelector('[role="status"]'),
  };
}

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
