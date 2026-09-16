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

const navigationScenarios = [
  "switch",
  "current error",
  "stale success",
  "stale error",
  "stale status",
  "draft",
];

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
