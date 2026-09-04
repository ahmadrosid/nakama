import { describe, expect, test } from "bun:test";
import {
  buildChatPath,
  buildNewChatPath,
  CHAT_DRAFT_STORAGE_PREFIX,
  chatProfileIdFromPath,
  clearLastChatModel,
  consumeStoredChatDraft,
  isChatSessionPath,
  isProfilesPath,
  lastChatModelStorageKey,
  parseChatRouteParams,
  pickKnownProfileId,
  readInitialDraftChatProfileId,
  readLastChatModel,
  readRequestedDraftFromNewChatSearch,
  readRequestedDraftKeyFromNewChatSearch,
  readRequestedProfileFromNewChatSearch,
  resolveActiveProfileIdFromLocation,
  resolveDefaultProfileId,
  resolveHistoryProfileId,
  resolveProfilesPageProfileId,
  storeChatDraft,
  writeLastChatModel,
  writeStoredActiveChatProfileId,
} from "./chat-history";

describe("chat history route helpers", () => {
  test("builds and parses chat routes consistently", () => {
    expect(buildChatPath("profile 1", "session/2")).toBe(
      "/chat/profile%201/session%2F2"
    );
    expect(chatProfileIdFromPath("/chat/profile%201/session%2F2")).toBe(
      "profile 1"
    );
    expect(isChatSessionPath("/chat/profile%201/session%2F2")).toBe(true);
    expect(isChatSessionPath("/chat")).toBe(false);
    expect(parseChatRouteParams({ profileId: "p", sessionId: "s" })).toEqual({
      profileId: "p",
      sessionId: "s",
    });
    expect(parseChatRouteParams({ profileId: "", sessionId: "s" })).toBeNull();
  });

  test("buildNewChatPath carries profile so ChatPage remount keeps the selection", () => {
    const path = buildNewChatPath("gary-vee");
    const url = new URL(path, "http://nakama.local");
    expect(url.pathname).toBe("/chat");
    expect(url.searchParams.get("new")).toBe("1");
    expect(url.searchParams.get("profile")).toBe("gary-vee");
    expect(url.searchParams.get("_")).toBeNull();
    expect(readRequestedProfileFromNewChatSearch(url.search)).toBe("gary-vee");
  });

  test("storeChatDraft uses unique keys for rapid calls", () => {
    const store = new Map<string, string>();
    const previousSessionStorage = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => {
          store.delete(key);
        },
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });

    try {
      const keys = Array.from({ length: 20 }, (_, index) =>
        storeChatDraft(`draft-${index}`)
      );
      expect(new Set(keys).size).toBe(keys.length);
      expect(consumeStoredChatDraft(keys[0]!)).toBe("draft-0");
      expect(consumeStoredChatDraft(keys[1]!)).toBe("draft-1");
      expect(store.has(`${CHAT_DRAFT_STORAGE_PREFIX}${keys[0]}`)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: previousSessionStorage,
      });
    }
  });

  test("reads the requested profile only for new chat links", () => {
    expect(
      readRequestedProfileFromNewChatSearch("?new=1&profile=default")
    ).toBe("default");
    expect(
      readRequestedProfileFromNewChatSearch("?profile=default")
    ).toBeNull();
  });

  test("reads draft params for new chat links", () => {
    expect(readRequestedDraftFromNewChatSearch("?new=1&draft=fix%20tool")).toBe(
      "fix tool"
    );
    expect(readRequestedDraftKeyFromNewChatSearch("?new=1&draftKey=abc")).toBe(
      "abc"
    );
    expect(readRequestedDraftFromNewChatSearch("?draft=fix")).toBeNull();
  });

  test("resolveActiveProfileIdFromLocation prefers URL, live chat state, and defaults", () => {
    const profiles = [{ id: "default" }, { id: "super" }];

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/chat/default/session-1",
        profiles,
        search: "",
      })
    ).toBe("default");

    expect(
      resolveActiveProfileIdFromLocation({
        liveChatProfileId: "super",
        pathname: "/chat",
        profiles,
        search: "",
      })
    ).toBe("super");

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/chat",
        profiles,
        search: "?new=1&profile=super",
      })
    ).toBe("super");

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/history",
        profiles,
        search: "?profile=super",
      })
    ).toBe("super");

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/history",
        profiles,
        search: "",
      })
    ).toBe("default");

    expect(
      resolveActiveProfileIdFromLocation({
        liveChatProfileId: "super",
        pathname: "/history",
        profiles,
        search: "",
      })
    ).toBe("super");

    expect(
      resolveActiveProfileIdFromLocation({
        liveChatProfileId: "default",
        pathname: "/profiles",
        profiles,
        search: "?profile=super",
      })
    ).toBe("super");

    expect(
      resolveActiveProfileIdFromLocation({
        liveChatProfileId: "super",
        pathname: "/profiles/skills/skill-1",
        profiles,
        search: "?profile=default",
      })
    ).toBe("default");
  });

  test("isProfilesPath matches the profiles section", () => {
    expect(isProfilesPath("/profiles")).toBe(true);
    expect(isProfilesPath("/profiles/skills/skill-1")).toBe(true);
    expect(isProfilesPath("/chat")).toBe(false);
  });

  test("resolveProfilesPageProfileId prefers the URL profile", () => {
    const profiles = [{ id: "default" }, { id: "super" }];

    expect(
      resolveProfilesPageProfileId({
        liveChatProfileId: "default",
        profiles,
        search: "?profile=super",
      })
    ).toBe("super");

    expect(
      resolveProfilesPageProfileId({
        liveChatProfileId: "super",
        profiles,
        search: "",
      })
    ).toBe("super");
  });

  test("resolveHistoryProfileId restores stored selection when URL has no profile", () => {
    const profiles = [{ id: "default" }, { id: "super" }];
    const store = new Map<string, string>();
    const previousLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => {
          store.delete(key);
        },
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });

    try {
      writeStoredActiveChatProfileId("super");

      expect(
        resolveHistoryProfileId({
          profiles,
          search: "",
        })
      ).toBe("super");

      expect(
        resolveHistoryProfileId({
          profiles,
          search: "?profile=default",
        })
      ).toBe("default");

      expect(
        resolveHistoryProfileId({
          liveChatProfileId: "default",
          profiles,
          search: "",
        })
      ).toBe("default");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousLocalStorage,
      });
    }
  });

  test("resolveDefaultProfileId picks default or first profile", () => {
    const profiles = [{ id: "default" }, { id: "super" }];
    expect(resolveDefaultProfileId(profiles)).toBe("default");
    expect(resolveDefaultProfileId([{ id: "alpha" }])).toBe("alpha");
  });

  test("readInitialDraftChatProfileId restores stored selection on refresh", () => {
    const store = new Map<string, string>();
    const previousLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => {
          store.delete(key);
        },
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });

    try {
      writeStoredActiveChatProfileId("super");

      expect(
        readInitialDraftChatProfileId({
          search: "",
        })
      ).toBe("super");

      expect(
        readInitialDraftChatProfileId({
          search: "?new=1&profile=default",
        })
      ).toBe("default");

      expect(
        readInitialDraftChatProfileId({
          routeProfileId: "session-profile",
          search: "",
        })
      ).toBe("session-profile");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousLocalStorage,
      });
    }
  });

  test("pickKnownProfileId validates against the profiles list", () => {
    const profiles = [{ id: "default" }, { id: "super" }];
    expect(pickKnownProfileId(profiles, "missing", "super")).toBe("super");
    expect(pickKnownProfileId(profiles, "missing")).toBeNull();
  });

  test("remembers the last hand-picked model per profile", () => {
    const store = new Map<string, string>();
    const previousLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => {
          store.delete(key);
        },
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });

    try {
      expect(readLastChatModel("default")).toBeNull();

      writeLastChatModel("default", "openai-1::gpt-5.6");
      writeLastChatModel("super", "anthropic-1::claude-opus-5");

      expect(store.get(lastChatModelStorageKey("default"))).toBe(
        "openai-1::gpt-5.6"
      );
      expect(readLastChatModel("default")).toBe("openai-1::gpt-5.6");
      // Each profile keeps its own pick.
      expect(readLastChatModel("super")).toBe("anthropic-1::claude-opus-5");

      // Empty writes never clobber a stored pick.
      writeLastChatModel("default", "");
      expect(readLastChatModel("default")).toBe("openai-1::gpt-5.6");

      clearLastChatModel("default");
      expect(readLastChatModel("default")).toBeNull();
      expect(readLastChatModel("super")).toBe("anthropic-1::claude-opus-5");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousLocalStorage,
      });
    }
  });
});
