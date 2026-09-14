import { expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppProvider } from "@/context/app-context";
import { AuthProvider } from "@/context/auth-context";
import { client } from "@/lib/client";
import { type ChatPageState, useChatPage } from "./use-chat-page";

test.each([false, true])(
  "queued messages keep the sending session (branch override: %s)",
  async (branchOverride) => {
    const queryClient = new QueryClient();
    const sessionsKey = ["sessions", "default", "web"];
    queryClient.setQueryData(sessionsKey, []);
    const previousStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => null, removeItem() {}, setItem() {} },
    });
    let page!: ChatPageState;
    function Probe() {
      page = useChatPage();
      return null;
    }

    const sent: { message: string; sessionId: string }[] = [];
    let finishFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let finishQueue!: () => void;
    const queueFinished = new Promise<void>((resolve) => {
      finishQueue = resolve;
    });
    const streamMocks: ReturnType<typeof spyOn>[] = [];
    function session(id: string) {
      const chat = client.createChatSession(id, "web");
      streamMocks.push(
        spyOn(chat, "sendStream").mockImplementation(async (input) => {
          const message = typeof input === "string" ? input : input.message;
          sent.push({ message, sessionId: id });
          if (sent.length === 1) {
            await firstResponse;
          }
          return "reply";
        })
      );
      return chat;
    }
    const createSession = spyOn(client, "createSession").mockImplementation(
      async () => session(`created-${createSession.mock.calls.length}`)
    );
    const getMessages = spyOn(client, "getSessionMessages").mockImplementation(
      async () => {
        if (sent.length === 3) {
          finishQueue();
        }
        return {
          channel: "web",
          messageMeta: [],
          messages: [],
          model: null,
          questionnaire: null,
          todos: [],
        };
      }
    );

    try {
      renderToString(
        <MemoryRouter initialEntries={["/chat?new=1&profile=default"]}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppProvider>
                <Probe />
              </AppProvider>
            </AuthProvider>
          </QueryClientProvider>
        </MemoryRouter>
      );
      const first = page.sendMessage("first", [], {
        sessionOverride: branchOverride ? session("branch") : undefined,
      });
      await page.sendMessage("second");
      await page.sendMessage("third");
      finishFirst();
      await first;
      await queueFinished;

      const sessionId = branchOverride ? "branch" : "created-1";
      expect(sent).toEqual(
        ["first", "second", "third"].map((message) => ({ message, sessionId }))
      );
      expect(createSession).toHaveBeenCalledTimes(branchOverride ? 0 : 1);
      expect(queryClient.getQueryState(sessionsKey)?.isInvalidated).toBe(true);
    } finally {
      createSession.mockRestore();
      getMessages.mockRestore();
      for (const stream of streamMocks) {
        stream.mockRestore();
      }
      queryClient.clear();
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  }
);
