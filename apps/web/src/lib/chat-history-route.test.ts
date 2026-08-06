import { describe, expect, test } from "bun:test";
import {
  buildChatPath,
  buildNewChatPath,
  chatProfileIdFromPath,
  isChatSessionPath,
  parseChatRouteParams,
  readRequestedDraftFromNewChatSearch,
  readRequestedDraftKeyFromNewChatSearch,
  readRequestedProfileFromNewChatSearch,
  readInitialDraftChatProfileId,
  pickKnownProfileId,
  resolveActiveProfileIdFromLocation,
  resolveDefaultProfileId,
  resolveHistoryProfileId,
  sessionStorageKey,
  writeStoredActiveChatProfileId,
} from "./chat-history";

describe("chat history route helpers", () => {
  test("builds and parses chat routes consistently", () => {
    expect(buildChatPath("profile 1", "session/2")).toBe("/chat/profile%201/session%2F2");
    expect(chatProfileIdFromPath("/chat/profile%201/session%2F2")).toBe("profile 1");
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
    expect(readRequestedProfileFromNewChatSearch(url.search)).toBe("gary-vee");
  });

  test("reads the requested profile only for new chat links", () => {
    expect(readRequestedProfileFromNewChatSearch("?new=1&profile=default")).toBe("default");
    expect(readRequestedProfileFromNewChatSearch("?profile=default")).toBeNull();
  });

  test("reads draft params for new chat links", () => {
    expect(readRequestedDraftFromNewChatSearch("?new=1&draft=fix%20tool")).toBe("fix tool");
    expect(readRequestedDraftKeyFromNewChatSearch("?new=1&draftKey=abc")).toBe("abc");
    expect(readRequestedDraftFromNewChatSearch("?draft=fix")).toBeNull();
  });

  test("uses a profile-scoped session storage key", () => {
    expect(sessionStorageKey("default")).toBe("nakama:session:default");
  });

  test("resolveActiveProfileIdFromLocation prefers URL, live chat state, and defaults", () => {
    const profiles = [{ id: "default" }, { id: "super" }];

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/chat/default/session-1",
        search: "",
        profiles,
      }),
    ).toBe("default");

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/chat",
        search: "",
        profiles,
        liveChatProfileId: "super",
      }),
    ).toBe("super");

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/chat",
        search: "?new=1&profile=super",
        profiles,
      }),
    ).toBe("super");

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/history",
        search: "?profile=super",
        profiles,
      }),
    ).toBe("super");

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/history",
        search: "",
        profiles,
      }),
    ).toBe("default");

    expect(
      resolveActiveProfileIdFromLocation({
        pathname: "/history",
        search: "",
        profiles,
        liveChatProfileId: "super",
      }),
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
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });

    try {
      writeStoredActiveChatProfileId("super");

      expect(
        resolveHistoryProfileId({
          search: "",
          profiles,
        }),
      ).toBe("super");

      expect(
        resolveHistoryProfileId({
          search: "?profile=default",
          profiles,
        }),
      ).toBe("default");

      expect(
        resolveHistoryProfileId({
          search: "",
          profiles,
          liveChatProfileId: "default",
        }),
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
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });

    try {
      writeStoredActiveChatProfileId("super");

      expect(
        readInitialDraftChatProfileId({
          search: "",
        }),
      ).toBe("super");

      expect(
        readInitialDraftChatProfileId({
          search: "?new=1&profile=default",
        }),
      ).toBe("default");

      expect(
        readInitialDraftChatProfileId({
          search: "",
          routeProfileId: "session-profile",
        }),
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
});
