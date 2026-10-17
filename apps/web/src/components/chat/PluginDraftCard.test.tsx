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

async function renderDraft(
  lifecycleState: "enabled" | "disabled",
  role = "member"
) {
  const plugin: OrgPluginDetail = {
    actions: [],
    availableVersions: ["0.1.0"],
    databaseGeneration: null,
    description: "Notes plugin.",
    installed: true,
    lastLifecycleError: null,
    lifecycleState,
    name: "Notes",
    pendingOperation: null,
    pluginId: "notes",
    revision: 1,
    selectedVersion: "0.1.0",
    ui: { assetsDir: "ui", entryModule: "ui/app.js", pageLabel: "Notes" },
    updatedAt: "2026-10-13T00:00:00Z",
  };

  const list = spyOn(client, "listOrgPlugins").mockResolvedValue({
    plugins: [plugin],
  });

  const shown: ChatAttachmentPanelConfig[] = [];

  const panel: ChatAttachmentPanelContextValue = {
    activeId: null,
    hide: () => {},
    isFullscreen: false,
    isOpen: false,
    show: (config) => {
      shown.push(config);
    },
    update: () => {},
  };

  // SAFETY: The card reads only the active org and platform admin flag.
  const auth = {
    activeOrg: { id: "org-a", role },
    user: { isPlatformAdmin: false },
  } as AuthContextValue;

  const messages: ChatListItem[] = [
    {
      content: "",
      id: "draft",
      role: "tool",
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
  ];

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

  const enable = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Enable plugin"
  );

  return { enable, open, shown };
}

test("opens an enabled plugin page in the side panel", async () => {
  const { open, shown } = await renderDraft("enabled");

  await act(async () => open?.click());

  expect(
    shown.map(({ defaultWidth, id, title }) => ({ defaultWidth, id, title }))
  ).toEqual([{ defaultWidth: 768, id: "plugin:notes", title: "Notes" }]);
});

test("does not offer the panel before the plugin is enabled", async () => {
  const { open } = await renderDraft("disabled");

  expect(open).toBeUndefined();
});

test("opens the plugin page in the side panel after enable", async () => {
  const enableCall = spyOn(client, "enableOrgPlugin").mockResolvedValue(
    // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
    {} as OrgPluginDetail
  );

  cleanups.push(() => enableCall.mockRestore());

  const { enable, shown } = await renderDraft("disabled", "admin");

  await act(async () => {
    enable?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(enableCall).toHaveBeenCalledWith("notes", 1, "org-a");
  expect(shown.map(({ id }) => id)).toEqual(["plugin:notes"]);
});
