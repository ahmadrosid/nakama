import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { VirtuosoMockContext } from "react-virtuoso";
import {
  ChatMessageList,
  type SaveCaseReply,
} from "@/components/chat/chat-message-list";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ThemeProvider } from "@/context/theme-context";

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

test("an earlier reply saves with its own index and only its final text", async () => {
  const onSaveAsCase = mock((_reply: SaveCaseReply) => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
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
                      content: "Why did it fail?",
                      historyIndex: 0,
                      id: "u1",
                      role: "user",
                    },
                    {
                      content: "Let me check the logs.",
                      historyIndex: 1,
                      id: "a1",
                      role: "assistant",
                    },
                    {
                      content: "The health check timed out.",
                      historyIndex: 2,
                      id: "a2",
                      role: "assistant",
                    },
                    {
                      content: "And now?",
                      historyIndex: 3,
                      id: "u2",
                      role: "user",
                    },
                    {
                      content: "It passes.",
                      historyIndex: 4,
                      id: "a3",
                      role: "assistant",
                    },
                  ]}
                  onSaveAsCase={onSaveAsCase}
                  sessionId="s1"
                />
              </VirtuosoMockContext.Provider>
            </AuthContext.Provider>
          </ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const menus = await waitFor(() => {
    const found = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Message actions"]'
    );

    return found.length === 2 ? found : null;
  });

  await act(async () => menus[0]!.click());

  const item = await waitFor(() =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.textContent === "Save as test case"
    )
  );

  await act(async () => item.click());

  expect(onSaveAsCase).toHaveBeenCalledWith({
    expectedResult: "The health check timed out.",
    messageIndex: 2,
  });
});
