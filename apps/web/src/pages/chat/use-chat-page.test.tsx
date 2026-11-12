import { expect, spyOn, test } from "bun:test";
import { NakamaClient } from "@nakama/client";
import type { AgentChannel, ChatMessage } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import { AppProvider } from "@/context/app-context";
import { AppContext } from "@/context/app-context-shared";
import { AuthProvider } from "@/context/auth-context";
import { AuthContext } from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { type ChatPageState, useChatPage } from "./use-chat-page";

test.each([false, true])(
  "queued messages keep the sending session (branch override: %s)",
  async (branchOverride) => {
    const queryClient = new QueryClient();
    const sessionsKey = ["sessions", "default"];
    const ownArtifactKey = ["artifacts", "default", "exists", "report.md"];
    const otherArtifactKey = ["artifacts", "other", "exists", "report.md"];
    queryClient.setQueryData(sessionsKey, []);
    queryClient.setQueryData(ownArtifactKey, true);
    queryClient.setQueryData(otherArtifactKey, true);
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
          const message = input instanceof Object ? input.message : input;
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
      expect(queryClient.getQueryState(ownArtifactKey)?.isInvalidated).toBe(
        true
      );
      expect(queryClient.getQueryState(otherArtifactKey)?.isInvalidated).toBe(
        true
      );
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

    expect(page.cognito).toBe(false);

    page.handleCognitoChange(true);
    await page.sendMessage("what do you know about me");

    expect(createSession.mock.calls[0]?.[1]).toMatchObject({ cognito: true });
    // The id must not survive a reload; storing it would resurrect a chat
    // that is supposed to be gone.
    expect(Object.keys(stored)).toEqual([]);

    const cognitoSessionId = "created-1";
    page.handleCognitoChange(false);
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

const navigationScenarios = [
  "switch",
  "current error",
  "stale success",
  "stale error",
  "stale status",
  "draft",
];

const RETRY_MESSAGES: ChatMessage[] = [
  { content: "first prompt", role: "user" },
  { content: "first answer", role: "assistant" },
  { content: "second prompt", role: "user" },
  { content: "second answer", role: "assistant" },
];

/**
 * Renders useChatPage at `initialEntry` with the client calls every chat test
 * needs. `messagesFor` answers getSessionMessages; `restore` undoes the rest.
 */
async function renderChatPage({
  initialEntry,
  messagesFor,
}: {
  initialEntry: string;
  messagesFor: (id: string) => {
    channel: AgentChannel;
    messages: ChatMessage[];
  };
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  );

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
  });
  const previousProfile = useActiveChatProfileStore.getState();
  useActiveChatProfileStore.setState({ orgId: null, profileId: "default" });

  const spies = [
    spyOn(client, "getMe").mockRejectedValue(new Error("Unauthenticated")),
    spyOn(client, "listUserOrgs").mockResolvedValue({ orgs: [] }),
    spyOn(client, "listProfiles").mockResolvedValue({ profiles: [] }),
    spyOn(client, "getThinkingSettings").mockResolvedValue({
      effort: "medium",
      enabled: false,
    }),
    spyOn(client, "getSessionStatus").mockResolvedValue({ active: false }),
    spyOn(client, "getSessionMessages").mockImplementation(async (id) => ({
      ...messagesFor(id),
      messageMeta: [],
      model: null,
      questionnaire: null,
      todos: [],
    })),
  ];

  let page!: ChatPageState;
  let pathname = "";
  let navigate!: (to: string) => void;

  function Probe() {
    page = useChatPage();
    pathname = useLocation().pathname;
    navigate = useNavigate();

    return null;
  }

  const root = createRoot(document.createElement("div"));

  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppContext.Provider
              value={{
                configureProvider: async () => {
                  throw new Error("Unexpected write");
                },
                createProvider: async () => {
                  throw new Error("Unexpected write");
                },
                error: null,
                health: null,
                loading: false,
                models: null,
              }}
            >
              <Routes>
                <Route
                  element={<Probe />}
                  path="/chat/:profileId?/:sessionId?"
                />
              </Routes>
            </AppContext.Provider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )
  );

  return {
    navigate: (to: string) => act(async () => navigate(to)),
    get page() {
      return page;
    },
    get pathname() {
      return pathname;
    },
    restore: async () => {
      await act(async () => root.unmount());
      queryClient.clear();

      for (const spy of spies) {
        spy.mockRestore();
      }

      useActiveChatProfileStore.setState(previousProfile);
      window.localStorage.clear();

      if (previousStorage) {
        Object.defineProperty(globalThis, "localStorage", previousStorage);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    },
  };
}

/**
 * Chat sessions whose sends are recorded, built on a real client so a test can
 * read the channel each session carries through `createAutomation`.
 */
function createRetrySessions() {
  const sent: string[] = [];
  const automationBodies: Array<{ channel: AgentChannel; prompt: string }> = [];
  const spies: ReturnType<typeof spyOn>[] = [];

  const transport = new NakamaClient({
    baseUrl: "http://retry.test",
    fetch: async (url, options) => {
      if (String(url) !== "http://retry.test/v1/automations/draft") {
        throw new Error(`Unexpected request: ${url}`);
      }

      automationBodies.push(JSON.parse(String(options?.body)));

      return Response.json({ automation: null });
    },
  });

  const makeSession = (id: string, channel: AgentChannel) => {
    const chat = transport.createChatSession(id, channel);
    spies.push(
      spyOn(chat, "sendStream").mockImplementation(async () => {
        sent.push(id);

        return "retried answer";
      })
    );

    return chat;
  };

  const createSession = spyOn(client, "createSession").mockImplementation(
    async (channel) => makeSession("fresh", channel)
  );

  spies.push(
    spyOn(client, "createChatSession").mockImplementation(makeSession),
    createSession
  );

  return {
    automationBodies,
    createSession,
    restore: () => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
    sent,
  };
}

function replyAt(page: ChatPageState, historyIndex: number) {
  const reply = page.messages.find(
    (message) => message.historyIndex === historyIndex
  );

  if (!reply) {
    throw new Error("Missing reply fixture");
  }

  return reply;
}

const retryChannelCases = [
  ["first web reply", "web", 1, "web"],
  ["later web reply", "web", 3, "web"],
  ["first CLI reply", "cli", 1, "web"],
  ["later CLI reply", "cli", 3, "cli"],
  ["first task reply", "task", 1, "web"],
  ["later task reply", "task", 3, "task"],
  ["first automation reply", "automation", 1, "web"],
  ["later automation reply", "automation", 3, "automation"],
  ["first sub-agent reply", "subagent", 1, "web"],
  ["later sub-agent reply", "subagent", 3, "subagent"],
] as const;

test.each(retryChannelCases)(
  "retry keeps the destination channel: %s",
  async (_name, sourceChannel, historyIndex, expectedChannel) => {
    const destinationId = historyIndex === 1 ? "fresh" : "branched";
    const sessions = createRetrySessions();

    // Like the server's inheritFrom, a branch keeps its source's channel.
    const branchSession = spyOn(client, "branchSession").mockResolvedValue({
      channel: sourceChannel,
      sessionId: "branched",
    });

    const chat = await renderChatPage({
      initialEntry: "/chat/default/source",
      messagesFor: (id) => ({
        channel: id === "fresh" ? "web" : sourceChannel,
        messages: RETRY_MESSAGES,
      }),
    });

    try {
      expect(chat.page.sessionChannel).toBe(sourceChannel);

      await act(async () =>
        chat.page.handleTryAgainMessage(replyAt(chat.page, historyIndex))
      );

      expect(chat.page.error).toBeNull();
      expect(chat.page.session?.id).toBe(destinationId);
      expect(chat.pathname).toBe(`/chat/default/${destinationId}`);
      expect(sessions.sent).toEqual([destinationId]);
      expect(sessions.createSession).toHaveBeenCalledTimes(
        historyIndex === 1 ? 1 : 0
      );
      expect(branchSession).toHaveBeenCalledTimes(historyIndex === 3 ? 1 : 0);
      expect(chat.page.sessionChannel).toBe(expectedChannel);
      expect(chat.page.readOnlySession).toBe(false);
      // The real serializer exposes the session's captured channel.
      await chat.page.session?.createAutomation("retry follow-up");
      expect(sessions.automationBodies).toEqual([
        { channel: expectedChannel, prompt: "retry follow-up" },
      ]);
    } finally {
      await chat.restore();
      sessions.restore();
      branchSession.mockRestore();
    }
  }
);

test.each([1, 3])(
  "retry in a read-only chat does nothing (reply %i)",
  async (historyIndex) => {
    const sessions = createRetrySessions();

    const branchSession = spyOn(client, "branchSession").mockResolvedValue({
      channel: "telegram",
      sessionId: "branched",
    });

    const chat = await renderChatPage({
      initialEntry: "/chat/default/source",
      messagesFor: () => ({ channel: "telegram", messages: RETRY_MESSAGES }),
    });

    try {
      await act(async () =>
        chat.page.handleTryAgainMessage(replyAt(chat.page, historyIndex))
      );

      expect(chat.page.error).toBeNull();
      expect(chat.page.session?.id).toBe("source");
      expect(chat.page.sessionChannel).toBe("telegram");
      expect(chat.page.readOnlySession).toBe(true);
      expect(sessions.sent).toEqual([]);
      expect(sessions.createSession).not.toHaveBeenCalled();
      expect(branchSession).not.toHaveBeenCalled();
    } finally {
      await chat.restore();
      sessions.restore();
      branchSession.mockRestore();
    }
  }
);

// The server's answer wins over what the page last loaded.
test("a retry branch takes its channel from the server", async () => {
  const sessions = createRetrySessions();

  const branchSession = spyOn(client, "branchSession").mockResolvedValue({
    channel: "task",
    sessionId: "branched",
  });

  const chat = await renderChatPage({
    initialEntry: "/chat/default/source",
    messagesFor: (id) => ({
      channel: id === "source" ? "cli" : "task",
      messages: RETRY_MESSAGES,
    }),
  });

  try {
    await act(async () =>
      chat.page.handleTryAgainMessage(replyAt(chat.page, 3))
    );

    expect(chat.page.sessionChannel).toBe("task");
    await chat.page.session?.createAutomation("retry follow-up");
    expect(sessions.automationBodies).toEqual([
      { channel: "task", prompt: "retry follow-up" },
    ]);
  } finally {
    await chat.restore();
    sessions.restore();
    branchSession.mockRestore();
  }
});

const staleRetryCases = [
  ["a branch", 3, "resolve"],
  ["a new chat", 1, "resolve"],
  ["a failed branch", 3, "reject"],
] as const;

test.each(staleRetryCases)(
  "a retry that returns after the user opened another chat leaves it alone: %s",
  async (_name, historyIndex, outcome) => {
    const sessions = createRetrySessions();
    const answered = Promise.withResolvers<void>();

    const branchSession = spyOn(client, "branchSession").mockImplementation(
      async () => {
        await answered.promise;

        if (outcome === "reject") {
          throw new Error("branch failed");
        }

        return { channel: "cli", sessionId: "branched" };
      }
    );

    const createSessionAnswer = sessions.createSession.getMockImplementation();

    sessions.createSession.mockImplementation(
      async (...args: Parameters<typeof client.createSession>) => {
        await answered.promise;

        return createSessionAnswer!(...args);
      }
    );

    const chat = await renderChatPage({
      initialEntry: "/chat/default/source",
      messagesFor: (id) => ({
        channel: id === "other" ? "telegram" : "cli",
        messages: RETRY_MESSAGES,
      }),
    });

    try {
      let retry!: Promise<void>;

      await act(async () => {
        retry = chat.page.handleTryAgainMessage(
          replyAt(chat.page, historyIndex)
        );
      });
      await chat.navigate("/chat/default/other");
      expect(chat.page.session?.id).toBe("other");

      await act(async () => {
        answered.resolve();
        await retry;
      });

      expect(chat.page.session?.id).toBe("other");
      expect(chat.page.sessionChannel).toBe("telegram");
      expect(chat.page.readOnlySession).toBe(true);
      expect(chat.page.error).toBeNull();
      expect(chat.pathname).toBe("/chat/default/other");
      expect(sessions.sent).toEqual([]);
    } finally {
      await chat.restore();
      sessions.restore();
      branchSession.mockRestore();
    }
  }
);

// A retry branch of a CLI chat stays CLI, and its failed turn is only stored
// in this browser, so loading the chat has to read it back.
test("a failed turn stored for a CLI chat is shown when the chat loads", async () => {
  window.localStorage.setItem(
    "nakama:failed-chat-turn:source",
    JSON.stringify({ error: "provider down", text: "third prompt" })
  );

  const chat = await renderChatPage({
    initialEntry: "/chat/default/source",
    messagesFor: () => ({ channel: "cli", messages: RETRY_MESSAGES }),
  });

  try {
    expect(chat.page.messages.some((message) => message.failed)).toBe(true);
  } finally {
    await chat.restore();
  }
});

test.each(navigationScenarios)(
  "session navigation keeps the requested chat: %s",
  async (scenario) => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");

    const { Route, Routes, useLocation, useNavigate } = await import(
      "react-router-dom"
    );

    const { AppContext } = await import("@/context/app-context-shared");

    const { useActiveChatProfileStore } = await import(
      "@/context/active-chat-profile-store"
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const previousStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage"
    );

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: window.localStorage,
    });
    const previousProfile = useActiveChatProfileStore.getState();
    useActiveChatProfileStore.setState({ orgId: null, profileId: "default" });

    const response = (id: string) => ({
      channel: "web" as const,
      messageMeta: [],
      messages: [{ content: id, role: "user" as const }],
      model: null,
      questionnaire: null,
      todos: [],
    });

    const pending = Promise.withResolvers<ReturnType<typeof response>>();
    const latest = Promise.withResolvers<ReturnType<typeof response>>();

    const mocks = [
      spyOn(client, "getMe").mockRejectedValue(new Error("Unauthenticated")),
      spyOn(client, "listUserOrgs").mockResolvedValue({ orgs: [] }),
      spyOn(client, "listProfiles").mockResolvedValue({ profiles: [] }),
      spyOn(client, "getThinkingSettings").mockResolvedValue({
        effort: "medium",
        enabled: false,
      }),
      spyOn(client, "getSessionStatus").mockImplementation(async (id) => {
        if (id === "b" && scenario === "stale status") {
          await pending.promise;

          return { active: true };
        }

        return { active: false };
      }),
    ];

    const getMessages = spyOn(client, "getSessionMessages").mockImplementation(
      async (id) => {
        if (
          id === "b" &&
          scenario !== "switch" &&
          scenario !== "stale status"
        ) {
          return pending.promise;
        }

        if (id === "c") {
          return latest.promise;
        }

        return response(id);
      }
    );

    let page!: ChatPageState;
    let navigate!: ReturnType<typeof useNavigate>;
    let pathname = "";

    function Probe() {
      page = useChatPage();
      navigate = useNavigate();
      pathname = useLocation().pathname;

      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () =>
        root.render(
          <MemoryRouter initialEntries={["/chat/default/a"]}>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <AppContext.Provider
                  value={{
                    configureProvider: async () => {
                      throw new Error("Unexpected write");
                    },
                    createProvider: async () => {
                      throw new Error("Unexpected write");
                    },
                    error: null,
                    health: null,
                    loading: false,
                    models: null,
                  }}
                >
                  <Routes>
                    <Route
                      element={<Probe />}
                      path="/chat/:profileId?/:sessionId?"
                    />
                  </Routes>
                </AppContext.Provider>
              </AuthProvider>
            </QueryClientProvider>
          </MemoryRouter>
        )
      );
      expect(page.session?.id).toBe("a");
      getMessages.mockClear();
      await act(async () => navigate("/chat/default/b"));
      expect(pathname).toBe("/chat/default/b");

      if (scenario === "switch") {
        expect(page.session?.id).toBe("b");
        expect(getMessages.mock.calls.map(([id]) => id)).toEqual(["b"]);
      } else if (scenario === "current error") {
        expect(page.busy).toBe(true);
        await act(async () => pending.reject(new Error("Load failed")));
        expect(page.busy).toBe(false);
        expect(page.error).not.toBeNull();
        expect(pathname).toBe("/chat/default/b");
      } else if (scenario === "draft") {
        await act(async () => navigate("/chat?new=1&profile=default"));
        await act(async () => pending.resolve(response("b")));
        expect(pathname).toBe("/chat");
        expect(page.session).toBeNull();
        expect(page.messages).toEqual([]);
        expect(page.busy).toBe(false);
      } else {
        await act(async () => navigate("/chat/default/c"));
        await act(async () => {
          if (scenario === "stale error") {
            pending.reject(new Error("Old load failed"));
          } else {
            pending.resolve(response("b"));
          }
        });
        expect(pathname).toBe("/chat/default/c");
        expect(page.busy).toBe(true);
        expect(page.error).toBeNull();
        await act(async () => latest.resolve(response("c")));
        expect(page.session?.id).toBe("c");
        expect(page.error).toBeNull();
        expect(page.busy).toBe(false);
        expect(getMessages.mock.calls.map(([id]) => id)).toEqual(["b", "c"]);
      }
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      getMessages.mockRestore();

      for (const mock of mocks) {
        mock.mockRestore();
      }

      useActiveChatProfileStore.setState(previousProfile);

      if (previousStorage) {
        Object.defineProperty(globalThis, "localStorage", previousStorage);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  }
);

test("switching chats does not refetch the profile list", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

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

  const spies = [
    // SAFETY: The mock covers only the fields this page test reads.
    spyOn(client, "getMe").mockResolvedValue({
      activeOrgId: "org1",
      id: "u1",
      isPlatformAdmin: false,
      orgId: "org1",
    } as never),
    // SAFETY: This test supplies only the organization row used by the page.
    spyOn(client, "listUserOrgs").mockResolvedValue({
      orgs: [{ id: "org1", name: "Org" }],
    } as never),
    // SAFETY: These fixture fields are the complete session view under test.
    spyOn(client, "getSessionMessages").mockResolvedValue({
      channel: "web",
      messageMeta: [],
      messages: [],
      model: null,
      questionnaire: null,
      todos: [],
    } as never),
    // SAFETY: The page reads only `active` from this session status fixture.
    spyOn(client, "getSessionStatus").mockResolvedValue({
      active: false,
    } as never),
    // SAFETY: The test does not use thinking settings.
    spyOn(client, "getThinkingSettings").mockResolvedValue({} as never),
    // SAFETY: The test reads only profile id and skills from this fixture.
    spyOn(client, "getProfile").mockResolvedValue({
      profile: { id: "p1", skills: [] },
    } as never),
  ];

  // SAFETY: This fixture supplies the profile row used by the page test.
  const listProfiles = spyOn(client, "listProfiles").mockResolvedValue({
    profiles: [{ id: "p1", name: "P1" }],
  } as never);

  let navigate!: ReturnType<typeof useNavigate>;
  let page!: ChatPageState;

  function Probe() {
    navigate = useNavigate();
    page = useChatPage();

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/chat/p1/s1"]}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppProvider>
                <Probe />
              </AppProvider>
            </AuthProvider>
          </QueryClientProvider>
        </MemoryRouter>
      )
    );
    await settle();
    expect(page.profiles.map((profile) => profile.id)).toEqual(["p1"]);
    const afterMount = listProfiles.mock.calls.length;
    expect(afterMount).toBe(1);

    for (const path of ["/chat/p1/s2", "/chat/p1/s1", "/chat/p1/s2"]) {
      await act(async () => navigate(path));
      await settle();
    }

    expect(listProfiles).toHaveBeenCalledTimes(afterMount);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    listProfiles.mockRestore();

    for (const spy of spies) {
      spy.mockRestore();
    }

    queryClient.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousStorage,
    });
  }
});

test("switching orgs clears the old chat while new profiles load", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  );

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
  });
  const previousProfile = useActiveChatProfileStore.getState();
  useActiveChatProfileStore.setState({ orgId: "orgA", profileId: "profileA" });
  queryClient.setQueryData(queryKeys.profiles.all, [
    { id: "profileA", name: "A" },
  ]);

  const nextProfiles = Promise.withResolvers<{
    profiles: { id: string; name: string }[];
  }>();

  // SAFETY: These fixture fields cover the session view used by this test.
  const getMessages = spyOn(client, "getSessionMessages").mockResolvedValue({
    channel: "web",
    messageMeta: [],
    messages: [{ content: "Org A message", role: "user" }],
    model: null,
    questionnaire: null,
    todos: [],
  } as never);

  const spies = [
    // SAFETY: The page reads only `active` from this session status fixture.
    spyOn(client, "getSessionStatus").mockResolvedValue({
      active: false,
    } as never),
    // SAFETY: The test does not use thinking settings.
    spyOn(client, "getThinkingSettings").mockResolvedValue({} as never),
    // SAFETY: The test reads only profile id and skills from this fixture.
    spyOn(client, "getProfile").mockResolvedValue({
      profile: { id: "profileA", skills: [] },
    } as never),
  ];

  // SAFETY: The deferred result supplies the profile rows asserted by this test.
  const listProfiles = spyOn(client, "listProfiles").mockImplementation(
    () => nextProfiles.promise as never
  );

  let page!: ChatPageState;
  let pathname = "";

  function Probe() {
    page = useChatPage();
    pathname = useLocation().pathname;

    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  const renderForOrg = (orgId: string) => (
    <MemoryRouter initialEntries={["/chat/profileA/sessionA"]}>
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={
            /* SAFETY: The test supplies every auth value read by this page. */
            {
              activeOrg: { id: orgId, name: orgId },
              isAuthenticated: true,
              isLoading: false,
              user: { activeOrgId: orgId, id: "user", orgId },
            } as never
          }
        >
          <AppProvider>
            <Routes>
              <Route element={<Probe />} path="/chat/:profileId?/:sessionId?" />
            </Routes>
          </AppProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>
  );

  try {
    client.setOrgId("orgA");
    await act(async () => root.render(renderForOrg("orgA")));
    await settle();
    expect(page.session?.id).toBe("sessionA");
    expect(page.messages).toHaveLength(1);
    expect(getMessages).toHaveBeenCalledTimes(1);

    client.setOrgId("orgB");
    // The auth context clears the cache when the org changes.
    queryClient.clear();
    await act(async () => root.render(renderForOrg("orgB")));
    expect(listProfiles).toHaveBeenCalledTimes(1);
    expect(pathname).toBe("/chat");
    expect(page.session).toBeNull();
    expect(page.messages).toEqual([]);
    expect(page.profileId).toBe("");
    expect(getMessages).toHaveBeenCalledTimes(1);

    await act(async () =>
      nextProfiles.resolve({ profiles: [{ id: "profileB", name: "B" }] })
    );
    await settle();
    expect(page.profileId).toBe("profileB");
    expect(getMessages).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    client.setOrgId(null);
    getMessages.mockRestore();
    listProfiles.mockRestore();

    for (const spy of spies) {
      spy.mockRestore();
    }

    queryClient.clear();
    useActiveChatProfileStore.setState(previousProfile);

    if (previousStorage) {
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});

test("waits for the active org profile query before selecting a profile", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  useActiveChatProfileStore.setState({ orgId: null, profileId: null });
  const previousStorage = globalThis.localStorage;

  const stored = new Map<string, string>([
    ["nakama:active-chat-profile", "org-a-profile"],
  ]);

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      removeItem: (key: string) => {
        stored.delete(key);
      },
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
    },
  });

  const profiles = Promise.withResolvers<{
    profiles: Array<{ id: string; name: string }>;
  }>();

  // SAFETY: The page test reads only these user fields from the response.
  const getMe = spyOn(client, "getMe").mockResolvedValue({
    activeOrgId: "org-b",
    id: "u1",
    isPlatformAdmin: false,
    orgId: "org-b",
  } as never);

  // SAFETY: This test reads only the active organization from the response.
  const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
    orgs: [{ id: "org-b", name: "Org B", role: "admin" }],
  } as never);

  // SAFETY: The deferred result supplies the profile rows asserted by this test.
  const listProfiles = spyOn(client, "listProfiles").mockImplementation(
    () => profiles.promise as ReturnType<typeof client.listProfiles>
  );

  // SAFETY: The page test reads only profile id, name, and skills.
  const getProfile = spyOn(client, "getProfile").mockResolvedValue({
    profile: { id: "default", name: "Default", skills: [] },
  } as never);

  // SAFETY: The fixture provides the settings used by the page test.
  const getThinkingSettings = spyOn(
    client,
    "getThinkingSettings"
  ).mockResolvedValue({ effort: "medium", enabled: false } as never);

  // SAFETY: These fixture fields cover the session view used by this test.
  const getSessionMessages = spyOn(
    client,
    "getSessionMessages"
  ).mockResolvedValue({
    channel: "web",
    messageMeta: [],
    messages: [],
    model: null,
    questionnaire: null,
    todos: [],
  } as never);

  // SAFETY: This test reads only `active` from the session status fixture.
  const getSessionStatus = spyOn(client, "getSessionStatus").mockResolvedValue({
    active: false,
  } as never);

  const chatSession = client.createChatSession("new-session", "web");

  const sendStream = spyOn(chatSession, "sendStream").mockResolvedValue(
    "reply"
  );

  const createSession = spyOn(client, "createSession").mockResolvedValue(
    chatSession
  );

  let page!: ChatPageState;

  function Probe() {
    page = useChatPage();

    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppProvider>
                <Probe />
              </AppProvider>
            </AuthProvider>
          </QueryClientProvider>
        </MemoryRouter>
      )
    );
    await act(async () => {
      profiles.resolve({ profiles: [{ id: "default", name: "Default" }] });
      await Bun.sleep(20);
    });

    expect(getProfile.mock.calls[0]?.[0]).toBe("default");
    expect(stored.get("nakama:active-chat-profile:org-b")).toBe("default");
    expect(stored.get("nakama:active-chat-profile")).toBeUndefined();

    await act(async () => {
      await page.sendMessage("hello");
    });
    expect(createSession.mock.calls[0]?.[1]?.profileId).toBe("default");
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();

    for (const mock of [
      getMe,
      listUserOrgs,
      listProfiles,
      getProfile,
      getThinkingSettings,
      getSessionMessages,
      getSessionStatus,
      sendStream,
      createSession,
    ]) {
      mock.mockRestore();
    }

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousStorage,
    });
  }
});

test("a member changes thinking effort for this chat only", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, removeItem() {}, setItem() {} },
  });

  const updateSession = spyOn(client, "updateSession").mockResolvedValue();
  const setThinking = spyOn(client, "setThinkingSettings");

  const spies = [
    // SAFETY: The mock covers only the fields this page test reads.
    spyOn(client, "getMe").mockResolvedValue({
      activeOrgId: "org1",
      id: "u1",
      isPlatformAdmin: false,
      orgId: "org1",
    } as never),
    // SAFETY: This test supplies only the organization row used by the page.
    spyOn(client, "listUserOrgs").mockResolvedValue({
      orgs: [{ id: "org1", name: "Org" }],
    } as never),
    spyOn(client, "getSessionMessages").mockResolvedValue({
      channel: "web",
      messageMeta: [],
      messages: [],
      model: null,
      questionnaire: null,
      thinkingEffort: "low",
      todos: [],
    }),
    // SAFETY: The page reads only `active` from this session status fixture.
    spyOn(client, "getSessionStatus").mockResolvedValue({
      active: false,
    } as never),
    spyOn(client, "getThinkingSettings").mockResolvedValue({
      effort: "medium",
      enabled: true,
    }),
    // SAFETY: The test reads only profile id and skills from this fixture.
    spyOn(client, "getProfile").mockResolvedValue({
      profile: { id: "p1", skills: [] },
    } as never),
    // SAFETY: This fixture supplies the profile row used by the page test.
    spyOn(client, "listProfiles").mockResolvedValue({
      profiles: [{ id: "p1", name: "P1" }],
    } as never),
  ];

  let page!: ChatPageState;

  function Probe() {
    page = useChatPage();

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/chat/p1/s1"]}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppProvider>
                <Routes>
                  <Route
                    element={<Probe />}
                    path="/chat/:profileId?/:sessionId?"
                  />
                </Routes>
              </AppProvider>
            </AuthProvider>
          </QueryClientProvider>
        </MemoryRouter>
      )
    );
    await settle();

    expect(page.thinkingEffort).toBe("low");
    expect(page.thinkingEffortDisabled).toBe(false);

    await act(async () => page.handleThinkingEffortChange("high"));
    await settle();

    expect(updateSession).toHaveBeenCalledWith("s1", {
      thinkingEffort: "high",
    });
    expect(setThinking).not.toHaveBeenCalled();
    expect(page.thinkingEffort).toBe("high");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    updateSession.mockRestore();
    setThinking.mockRestore();

    for (const spy of spies) {
      spy.mockRestore();
    }

    queryClient.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousStorage,
    });
  }
});

test("lowering a saved max that a model shows as high saves high", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, removeItem() {}, setItem() {} },
  });

  const updateSession = spyOn(client, "updateSession").mockResolvedValue();
  const setThinking = spyOn(client, "setThinkingSettings");

  const spies = [
    // SAFETY: The mock covers only the fields this page test reads.
    spyOn(client, "getMe").mockResolvedValue({
      activeOrgId: "org1",
      id: "u1",
      isPlatformAdmin: false,
      orgId: "org1",
    } as never),
    // SAFETY: This test supplies only the organization row used by the page.
    spyOn(client, "listUserOrgs").mockResolvedValue({
      orgs: [{ id: "org1", name: "Org" }],
    } as never),
    spyOn(client, "getSessionMessages").mockResolvedValue({
      channel: "web",
      messageMeta: [],
      messages: [],
      model: "or1::google/gemini-3.6-flash",
      questionnaire: null,
      thinkingEffort: "max",
      todos: [],
    }),
    // SAFETY: The page reads only `active` from this session status fixture.
    spyOn(client, "getSessionStatus").mockResolvedValue({
      active: false,
    } as never),
    // SAFETY: The models query waits only for providerConfigured.
    spyOn(client, "health").mockResolvedValue({
      ok: true,
      providerConfigured: true,
    } as never),
    // SAFETY: The page reads only the model list and provider id here.
    spyOn(client, "getModels").mockResolvedValue({
      currentProviderId: "or1",
      models: [
        {
          id: "google/gemini-3.6-flash",
          name: "Gemini 3.6 Flash",
          provider: "openrouter",
          providerId: "or1",
          supportsThinking: true,
        },
      ],
    } as never),
    spyOn(client, "getThinkingSettings").mockResolvedValue({
      effort: "medium",
      enabled: true,
    }),
    // SAFETY: The test reads only profile id and skills from this fixture.
    spyOn(client, "getProfile").mockResolvedValue({
      profile: { id: "p1", skills: [] },
    } as never),
    // SAFETY: This fixture supplies the profile row used by the page test.
    spyOn(client, "listProfiles").mockResolvedValue({
      profiles: [{ id: "p1", name: "P1" }],
    } as never),
  ];

  let page!: ChatPageState;

  function Probe() {
    page = useChatPage();

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/chat/p1/s1"]}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppProvider>
                <Routes>
                  <Route
                    element={<Probe />}
                    path="/chat/:profileId?/:sessionId?"
                  />
                </Routes>
              </AppProvider>
            </AuthProvider>
          </QueryClientProvider>
        </MemoryRouter>
      )
    );
    await settle();

    // Gemini takes no level above high, so the saved max shows as high.
    expect(page.thinkingEffort).toBe("high");

    await act(async () => page.handleThinkingEffortChange("high"));
    await settle();

    expect(updateSession).toHaveBeenCalledWith("s1", {
      thinkingEffort: "high",
    });
    expect(setThinking).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    updateSession.mockRestore();
    setThinking.mockRestore();

    for (const spy of spies) {
      spy.mockRestore();
    }

    queryClient.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousStorage,
    });
  }
});

test.each([false, true])(
  "a new chat with a draft sends it at once only when asked (send: %s)",
  async (send) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const previousStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage"
    );

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: window.localStorage,
    });
    const previousProfile = useActiveChatProfileStore.getState();
    useActiveChatProfileStore.setState({
      orgId: "orgA",
      profileId: "profileA",
    });
    queryClient.setQueryData(queryKeys.profiles.all, [
      { id: "profileA", name: "A" },
    ]);

    const sent: string[] = [];
    const streamMocks: ReturnType<typeof spyOn>[] = [];

    const createSession = spyOn(client, "createSession").mockImplementation(
      async () => {
        const chat = client.createChatSession("created", "web");
        streamMocks.push(
          spyOn(chat, "sendStream").mockImplementation(async (input) => {
            sent.push(input instanceof Object ? input.message : input);

            return "reply";
          })
        );

        return chat;
      }
    );

    const spies = [
      // SAFETY: These fixture fields cover the session view used by this test.
      spyOn(client, "getSessionMessages").mockResolvedValue({
        channel: "web",
        messageMeta: [],
        messages: [],
        model: null,
        questionnaire: null,
        todos: [],
      } as never),
      // SAFETY: The page reads only `active` from this session status fixture.
      spyOn(client, "getSessionStatus").mockResolvedValue({
        active: false,
      } as never),
      // SAFETY: The test does not use thinking settings.
      spyOn(client, "getThinkingSettings").mockResolvedValue({} as never),
      // SAFETY: The test reads only profile id and skills from this fixture.
      spyOn(client, "getProfile").mockResolvedValue({
        profile: { id: "profileA", skills: [] },
      } as never),
      // SAFETY: The page reads only profile id and name from this fixture.
      spyOn(client, "listProfiles").mockResolvedValue({
        profiles: [{ id: "profileA", name: "A" }],
      } as never),
    ];

    const container = document.createElement("div");
    const root = createRoot(container);
    const draft = "Create an automation. Every hour, check my email.";

    const search = new URLSearchParams({
      draft,
      intent: "automation",
      new: "1",
      profile: "profileA",
    });

    if (send) {
      search.set("send", "1");
    }

    function Probe() {
      useChatPage();

      return null;
    }

    try {
      await act(async () =>
        root.render(
          <StrictMode>
            <MemoryRouter initialEntries={[`/chat?${search}`]}>
              <QueryClientProvider client={queryClient}>
                <AuthContext.Provider
                  value={
                    /* SAFETY: The test supplies every auth value read by this page. */
                    {
                      activeOrg: { id: "orgA", name: "orgA" },
                      isAuthenticated: true,
                      isLoading: false,
                      user: { activeOrgId: "orgA", id: "user", orgId: "orgA" },
                    } as never
                  }
                >
                  <AppProvider>
                    <Routes>
                      <Route
                        element={<Probe />}
                        path="/chat/:profileId?/:sessionId?"
                      />
                    </Routes>
                  </AppProvider>
                </AuthContext.Provider>
              </QueryClientProvider>
            </MemoryRouter>
          </StrictMode>
        )
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(sent).toEqual(send ? [draft] : []);
      expect(createSession).toHaveBeenCalledTimes(send ? 1 : 0);
    } finally {
      await act(async () => root.unmount());
      createSession.mockRestore();

      for (const spy of [...spies, ...streamMocks]) {
        spy.mockRestore();
      }

      queryClient.clear();
      useActiveChatProfileStore.setState(previousProfile);
      window.localStorage.clear();

      if (previousStorage) {
        Object.defineProperty(globalThis, "localStorage", previousStorage);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  }
);
