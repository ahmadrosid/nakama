import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import {
  type ChatAttachmentPanelConfig,
  ChatAttachmentPanelContext,
} from "@/context/chat-attachment-panel-context-shared";

test("opening an artifact preview does not update the panel on every render", async () => {
  const queryClient = new QueryClient();
  const container = document.createElement("div");
  const root = createRoot(container);
  let openPanel!: () => void;
  let updates = 0;

  function Preview() {
    const [config, setConfig] = useState<ChatAttachmentPanelConfig | null>(
      null
    );

    const show = useCallback((next: ChatAttachmentPanelConfig) => {
      setConfig(next);
    }, []);

    const update = useCallback(
      (id: string, patch: Partial<ChatAttachmentPanelConfig>) => {
        updates += 1;
        setConfig((current) =>
          current?.id === id ? { ...current, ...patch } : current
        );
      },
      []
    );

    return (
      <ChatAttachmentPanelContext.Provider
        value={{
          activeId: config?.id ?? null,
          hide: () => setConfig(null),
          isFullscreen: false,
          isOpen: config !== null,
          show,
          update,
        }}
      >
        <PreviewHook />
      </ChatAttachmentPanelContext.Provider>
    );
  }

  function PreviewHook() {
    ({ openPanel } = useArtifactAttachmentPreviewPanel({
      artifact: {
        filename: "report.zip",
        mimeType: "application/zip",
        path: "report.zip",
        savedAt: "2026-10-07T00:00:00Z",
        sizeBytes: 12,
      },
      id: "report",
      profileId: "profile",
    }));

    return null;
  }

  // SAFETY: Preview reads only activeOrg and user from this fixture.
  const auth = { activeOrg: null, user: null } as AuthContextValue;

  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <Preview />
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    );
    await act(async () => openPanel());
    expect(updates).toBe(1);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
  }
});
