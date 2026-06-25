import { describe, expect, test } from "bun:test";
import type { ProfileSummary } from "./contract";
import {
  filterProfilesForChatAccess,
  resolveProfileInput,
} from "./profiles";

const profiles: ProfileSummary[] = [
  { id: "profile_b", name: "Beta", model: null, isDefault: false, isSuper: false },
  { id: "profile_a", name: "Alpha", model: null, isDefault: true, isSuper: false },
  { id: "super_bot", name: "Super Bot", model: null, isDefault: false, isSuper: true },
];

describe("resolveProfileInput", () => {
  test("matches id, name, and list index", () => {
    expect(resolveProfileInput(profiles, "profile_b")?.id).toBe("profile_b");
    expect(resolveProfileInput(profiles, "Alpha")?.id).toBe("profile_a");
    expect(resolveProfileInput(profiles, "2")?.id).toBe("profile_b");
  });

  test("returns undefined for ambiguous input", () => {
    expect(resolveProfileInput(profiles, "profile")).toBeUndefined();
  });
});

describe("filterProfilesForChatAccess", () => {
  test("hides super bot from org members and channel bridges", () => {
    expect(
      filterProfilesForChatAccess(profiles, { orgRole: "member" }).map((profile) => profile.id),
    ).toEqual(["profile_b", "profile_a"]);
    expect(
      filterProfilesForChatAccess(profiles, { orgRole: "admin", excludeSuperBot: true }).map(
        (profile) => profile.id,
      ),
    ).toEqual(["profile_b", "profile_a"]);
  });

  test("keeps super bot for org admins", () => {
    expect(
      filterProfilesForChatAccess(profiles, { orgRole: "admin" }).map((profile) => profile.id),
    ).toEqual(["profile_b", "profile_a", "super_bot"]);
  });
});
