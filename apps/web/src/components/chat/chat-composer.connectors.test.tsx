import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  McpServerSummary,
  ProfileDetail,
  ProfileResponse,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ChatComposer } from "@/components/chat/chat-composer";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

// SAFETY: opening the + menu reads only activeOrg and user from the auth context.
const auth = {
  activeOrg: {
    createdAt: "",
    id: "org-a",
    name: "A",
    role: "admin",
    slug: "a",
    updatedAt: "",
  },
  user: { email: "admin@example.com", id: "admin", isPlatformAdmin: true },
} as AuthContextValue;

function server(id: string, name: string): McpServerSummary {
  // SAFETY: literal fields match McpServerSummary; status and transport are valid enum values.
  return {
    createdAt: "",
    enabled: true,
    id,
    lastError: null,
    name,
    status: "connected",
    toolCount: 1,
    transport: "http",
    updatedAt: "",
  } as McpServerSummary;
}

const profileWith = (servers: McpServerSummary[]): ProfileResponse => ({
  // SAFETY: the Connectors submenu reads only `mcpServers` from the profile.
  profile: { id: "agent-a", mcpServers: servers } as ProfileDetail,
});

async function waitFor(check: () => boolean) {
  for (let tries = 0; tries < 50 && !check(); tries++) {
    await act(() => Bun.sleep(10));
  }
}

function findByText(selector: string, text: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((node) =>
    node.textContent?.includes(text)
  );
}

test("the Connectors submenu assigns an org MCP server to the chat's agent", async () => {
  const gmail = server("gmail", "Gmail");
  const drive = server("drive", "Drive");

  const assign = spyOn(client, "assignMcpServer").mockResolvedValue(
    profileWith([gmail, drive])
  );

  const spies = [
    assign,
    spyOn(client, "listMcpServers").mockResolvedValue({
      servers: [gmail, drive],
    }),
    spyOn(client, "getProfile").mockResolvedValue(profileWith([gmail])),
  ];

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    for (const spy of spies) {
      spy.mockRestore();
    }

    await act(async () => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AuthContext.Provider value={auth}>
            <PromptInputProvider>
              <ChatComposer
                busy={false}
                canStop={false}
                chatStatus="ready"
                currentModelSelection={null}
                error={null}
                onModelChange={() => undefined}
                onSubmit={() => undefined}
                profileId="agent-a"
                providerModelGroups={[]}
                renderModelLabel={() => null}
              />
            </PromptInputProvider>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const trigger = container.querySelector<HTMLElement>(
    'button[aria-label="Add attachment"]'
  );

  await act(async () => trigger?.click());
  await waitFor(() => Boolean(findByText('[role="menuitem"]', "MCP servers")));
  await act(async () =>
    findByText('[role="menuitem"]', "MCP servers")?.click()
  );

  const item = (name: string) => findByText('[role="menuitemcheckbox"]', name);

  await waitFor(
    () =>
      item("Drive")?.getAttribute("aria-disabled") !== "true" &&
      item("Gmail")?.getAttribute("aria-checked") === "true"
  );

  expect(item("Gmail")?.getAttribute("aria-checked")).toBe("true");
  expect(item("Drive")?.getAttribute("aria-checked")).toBe("false");

  await act(async () => item("Drive")?.click());
  await waitFor(() => assign.mock.calls.length > 0);

  expect(assign).toHaveBeenCalledWith("agent-a", { serverId: "drive" });
});
