import { afterEach, expect, spyOn, test } from "bun:test";
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

async function waitFor<T>(find: () => T | null | undefined): Promise<T> {
  for (let attempt = 0; attempt < 50 && !find(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  const found = find();
  expect(found).toBeTruthy();

  return found!;
}

test("a generated image shows in the reply instead of a file card", async () => {
  const spies = [
    spyOn(client, "hasProfileArtifact").mockResolvedValue(true),
    spyOn(client, "readProfileArtifactContent").mockResolvedValue({
      contentType: "image/png",
      data: new Uint8Array([137, 80, 78, 71]).buffer,
    }),
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
            <AuthContext.Provider
              value={
                /* SAFETY: the list reads only the active org and user. */
                {
                  activeOrg: { role: "member" },
                  user: { id: "u", isPlatformAdmin: false },
                } as AuthContextValue
              }
            >
              <VirtuosoMockContext.Provider
                value={{ itemHeight: 100, viewportHeight: 2000 }}
              >
                <ChatMessageList
                  messages={[
                    {
                      content: "@image a red fox",
                      historyIndex: 0,
                      id: "u1",
                      role: "user",
                    },
                    {
                      content: "",
                      historyIndex: 1,
                      id: "t1",
                      role: "tool",
                      tool: "generate_image",
                      toolInput: { prompt: "a red fox", size: "1536x1024" },
                      toolResult: {
                        attachmentId: "att-1",
                        mimeType: "image/png",
                        model: "MiniMax-H3-Image",
                        path: "artifacts/fox.png",
                        size: "1536x1024",
                        sizeBytes: 4,
                      },
                      toolStatus: "done",
                    },
                    {
                      content: "Here is the fox: artifacts/fox.png",
                      historyIndex: 2,
                      id: "a1",
                      role: "assistant",
                    },
                  ]}
                  profileId="bob"
                  sessionId="s1"
                />
              </VirtuosoMockContext.Provider>
            </AuthContext.Provider>
          </ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const image = await waitFor(() =>
    container.querySelector('[aria-label="Generated image"] img')
  );

  expect(image.getAttribute("alt")).toBe("a red fox");
  expect(container.querySelector('[aria-label="Open in: fox.png"]')).toBeNull();
});
