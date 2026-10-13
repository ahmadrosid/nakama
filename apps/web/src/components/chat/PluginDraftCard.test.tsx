import { afterEach, expect, spyOn, test } from "bun:test";
import type { OrgPluginDetail } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PluginDrafts } from "@/components/chat/PluginDraftCard";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import {
  type ChatAttachmentPanelConfig,
  ChatAttachmentPanelContext,
  type ChatAttachmentPanelContextValue,
} from "@/context/chat-attachment-panel-context-shared";
import type { ChatListItem } from "@/lib/chat-history";
import { client } from "@/lib/client";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

async function renderDraft(lifecycleState: "enabled" | "disabled") {
  // SAFETY: The card reads only these plugin fields.
  const plugin = {
    actions: [],
    installed: true,
    lifecycleState,
    name: "Notes",
    pluginId: "notes",
    revision: 1,
    selectedVersion: "0.1.0",
    ui: { assetsDir: "ui", entryModule: "ui/app.js", pageLabel: "Notes" },
  } as unknown as OrgPluginDetail;

  const list = spyOn(client, "listOrgPlugins").mockResolvedValue({
    plugins: [plugin],
  });

  const shown: ChatAttachmentPanelConfig[] = [];

  // SAFETY: The card calls only show on this fixture.
  const panel = {
    show: (config: ChatAttachmentPanelConfig) => {
      shown.push(config);
    },
  } as unknown as ChatAttachmentPanelContextValue;

  // SAFETY: The card reads only the active org and platform admin flag.
  const auth = {
    activeOrg: { id: "org-a", role: "member" },
    user: { isPlatformAdmin: false },
  } as AuthContextValue;

  // SAFETY: PluginDrafts reads only tool and toolResult from each item.
  const messages = [
    {
      tool: "submit_plugin_draft",
      toolResult: {
        actions: ["list"],
        draftId: "notes",
        fileCount: 3,
        name: "Notes",
        orgId: "org-a",
        pluginId: "notes",
        profileId: "super",
        type: "plugin_draft_ready",
        version: "0.1.0",
      },
    },
  ] as unknown as ChatListItem[];

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    list.mockRestore();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider value={auth}>
          <ChatAttachmentPanelContext.Provider value={panel}>
            <PluginDrafts complete messages={messages} usedTools={[]} />
          </ChatAttachmentPanelContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const open = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Open"
  );

  return { open, shown };
}

test("opens an enabled plugin page in the side panel", async () => {
  const { open, shown } = await renderDraft("enabled");

  await act(async () => open?.click());

  expect(shown.map(({ id, title }) => ({ id, title }))).toEqual([
    { id: "plugin:notes", title: "Notes" },
  ]);
});

test("does not offer the panel before the plugin is enabled", async () => {
  const { open } = await renderDraft("disabled");

  expect(open).toBeUndefined();
});
