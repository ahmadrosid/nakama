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

test("cognito sends the mode, stores no session id, and ends the old session", async () => {
  const queryClient = new QueryClient();
  const previousStorage = globalThis.localStorage;
  const stored: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored[key] ?? null,
      removeItem(key: string) {
        delete stored[key];
      },
      setItem(key: string, value: string) {
        stored[key] = value;
      },
    },
  });
  let page!: ChatPageState;
  function Probe() {
    page = useChatPage();
    return null;
  }

  const streamMocks: ReturnType<typeof spyOn>[] = [];
  const purged: string[] = [];
  // Bound before the spy below, or building a session would re-enter it.
  const realCreateChatSession = client.createChatSession.bind(client);
  function session(id: string) {
    const chat = realCreateChatSession(id, "web");
    streamMocks.push(
      spyOn(chat, "sendStream").mockImplementation(async () => "reply")
    );
    streamMocks.push(
      spyOn(chat, "purge").mockImplementation(async () => {
        purged.push(id);
      })
    );
    return chat;
  }
  const chatSessions = spyOn(client, "createChatSession").mockImplementation(
    (id) => session(id)
  );
  const createSession = spyOn(client, "createSession").mockImplementation(
    async () => session(`created-${createSession.mock.calls.length}`)
  );
  const getMessages = spyOn(client, "getSessionMessages").mockImplementation(
    async () => ({
      channel: "web",
      messageMeta: [],
      messages: [],
      model: null,
      questionnaire: null,
      todos: [],
    })
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

    expect(page.cognito).toBeNull();

    page.handleCognitoChange({ personalized: false });
    await page.sendMessage("what do you know about me");

    expect(createSession.mock.calls[0]?.[1]).toMatchObject({
      cognito: { personalized: false },
    });
    // The id must not survive a reload; storing it would resurrect a chat
    // that is supposed to be gone.
    expect(Object.keys(stored)).toEqual([]);

    const cognitoSessionId = "created-1";
    page.handleCognitoChange(null);
    await Promise.resolve();
    expect(purged).toEqual([cognitoSessionId]);

    await page.sendMessage("a normal question");
    expect(createSession.mock.calls[1]?.[1]).toMatchObject({
      cognito: undefined,
    });
    expect(Object.keys(stored).length).toBe(1);
  } finally {
    chatSessions.mockRestore();
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
});
