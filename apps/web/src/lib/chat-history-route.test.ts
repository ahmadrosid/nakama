import { describe, expect, test } from "bun:test";
import {
  buildChatPath,
  buildNewChatPath,
  chatProfileIdFromPath,
  parseChatRouteParams,
  readRequestedDraftFromNewChatSearch,
  readRequestedDraftKeyFromNewChatSearch,
  readRequestedProfileFromNewChatSearch,
  sessionStorageKey,
} from "./chat-history";

describe("chat history route helpers", () => {
  test("builds and parses chat routes consistently", () => {
    expect(buildChatPath("profile 1", "session/2")).toBe("/chat/profile%201/session%2F2");
    expect(chatProfileIdFromPath("/chat/profile%201/session%2F2")).toBe("profile 1");
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
});
