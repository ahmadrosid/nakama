import { describe, expect, test } from "bun:test";
import { resolveProfileSwitch } from "./profile-switch";

function pick(pathname: string, search = "", activeProfileId = "alpha") {
  return resolveProfileSwitch({
    activeProfileId,
    pathname,
    profileId: "beta",
    search,
  });
}

describe("resolveProfileSwitch", () => {
  test("Profiles swaps the agent in the URL, keeping the other params", () => {
    expect(pick("/profiles", "?profile=alpha&tab=skills")).toEqual({
      kind: "navigate",
      replace: true,
      to: "/profiles?profile=beta&tab=skills",
    });
  });

  test("a Profiles subpage goes back to the agent's profile", () => {
    expect(pick("/profiles/skills/web-search")).toEqual({
      kind: "navigate",
      replace: false,
      to: "/profiles?profile=beta",
    });
  });

  test("Files, Automations and the draft chat swap in place", () => {
    for (const pathname of ["/files", "/automations", "/chat"]) {
      expect(pick(pathname)).toEqual({ kind: "select" });
    }
  });

  test("an open session is replaced by a fresh chat", () => {
    expect(pick("/chat/alpha/session-1")).toEqual({
      kind: "navigate",
      replace: true,
      to: "/chat",
    });
  });

  test("any other page opens a fresh chat", () => {
    expect(pick("/settings")).toEqual({
      kind: "navigate",
      replace: false,
      to: "/chat",
    });
  });

  test("the agent already on screen stays put", () => {
    for (const pathname of ["/chat", "/chat/beta/session-1", "/files"]) {
      expect(pick(pathname, "", "beta")).toEqual({ kind: "stay" });
    }

    expect(pick("/profiles", "?profile=beta", "beta")).toEqual({
      kind: "stay",
    });
  });

  test("the active agent picked outside chat still opens its chat", () => {
    expect(pick("/settings", "", "beta")).toEqual({
      kind: "navigate",
      replace: false,
      to: "/chat",
    });
  });
});
