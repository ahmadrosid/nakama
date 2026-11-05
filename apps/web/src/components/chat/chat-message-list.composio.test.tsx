import { afterEach, expect, spyOn, test } from "bun:test";
import { NakamaApiError } from "@nakama/core/api-error";
import { COMPOSIO_CUSTOM_AUTH_REQUIRED } from "@nakama/core/contract";
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

async function clickConnect(role: "admin" | "member") {
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
    spyOn(client, "connectComposioToolkit").mockRejectedValue(NO_MANAGED_AUTH),
    spyOn(window, "open").mockReturnValue(null),
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
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ThemeProvider>
            <AuthContext.Provider value={authFor(role)}>
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
                        onAgent: true,
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
                  sessionId="s1"
                />
              </VirtuosoMockContext.Provider>
            </AuthContext.Provider>
          </ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const findConnect = () =>
    [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Connect"
    );

  await waitFor(() => findConnect()?.disabled === false);

  await act(async () => {
    findConnect()?.click();
  });

  await waitFor(() => container.querySelector('[role="status"]') !== null);

  return container;
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
