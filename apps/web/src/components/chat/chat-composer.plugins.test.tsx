import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type {
  McpServerSummary,
  OrgPluginDetail,
  ProfileDetail,
  ToolDetail,
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
import {
  ChatAttachmentPanelContext,
  type ChatAttachmentPanelContextValue,
} from "@/context/chat-attachment-panel-context-shared";
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

async function renderComposer(options: { withPlugin: boolean }) {
  const show = mock<ChatAttachmentPanelContextValue["show"]>(() => undefined);

  // SAFETY: the Plugins submenu reads only `lifecycleState`, `pluginId` and `ui` from a plugin.
  const dataPlugin = {
    lifecycleState: "enabled",
    pluginId: "data",
    ui: { assetsDir: "", entryModule: "", pageLabel: "Data" },
  } as OrgPluginDetail;

  // SAFETY: the Plugins submenu reads only `id` and `pluginId` from a tool.
  const dataTool = { id: "tool-1", pluginId: "data" } as ToolDetail;

  const noServers: McpServerSummary[] = [];

  // SAFETY: the Plugins submenu reads only `mcpServers` and `tools` from the profile.
  const profile = {
    id: "agent-a",
    mcpServers: noServers,
    tools: [{ id: dataTool.id }],
  } as ProfileDetail;

  const spies = [
    spyOn(client, "listOrgPlugins").mockResolvedValue({
      plugins: options.withPlugin ? [dataPlugin] : [],
    }),
    spyOn(client, "listTools").mockResolvedValue({ tools: [dataTool] }),
    spyOn(client, "listSkills").mockResolvedValue({ skills: [] }),
    spyOn(client, "getProfile").mockResolvedValue({ profile }),
  ];

  const panel: ChatAttachmentPanelContextValue = {
    activeId: null,
    hide: () => undefined,
    isFullscreen: false,
    isOpen: false,
    show,
    update: () => undefined,
  };

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
            <ChatAttachmentPanelContext.Provider value={panel}>
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
            </ChatAttachmentPanelContext.Provider>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  await act(async () =>
    container
      .querySelector<HTMLElement>('button[aria-label="Add attachment"]')
      ?.click()
  );
  await waitFor(() => Boolean(findByText('[role="menuitem"]', "Plugins")));
  await act(async () => findByText('[role="menuitem"]', "Plugins")?.click());

  return { show };
}

test("the Plugins submenu lists the agent's plugins and opens one in the side panel", async () => {
  const { show } = await renderComposer({ withPlugin: true });

  await waitFor(() => Boolean(findByText('[role="menuitem"]', "Data")));
  await act(async () => findByText('[role="menuitem"]', "Data")?.click());

  expect(show).toHaveBeenCalledTimes(1);
  expect(show.mock.calls[0]?.[0]).toMatchObject({
    id: "plugin:data",
    title: "Data",
  });
});

test("Add plugin opens the add dialog", async () => {
  await renderComposer({ withPlugin: false });

  await waitFor(() => Boolean(findByText('[role="menuitem"]', "Add plugin")));
  await act(async () => findByText('[role="menuitem"]', "Add plugin")?.click());
  await waitFor(() => Boolean(document.querySelector('[role="dialog"]')));

  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
