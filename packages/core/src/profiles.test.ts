import { describe, expect, test } from "bun:test";
import type { ProfileSummary } from "./contract";
import {
  filterProfilesForChatAccess,
  formatProfileSelectionPrompt,
  resolveProfileInScopes,
  resolveProfileInput,
  slugifyProfileName,
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

  test("matches super bot aliases", () => {
    expect(resolveProfileInput(profiles, "super_bot")?.id).toBe("super_bot");
    expect(resolveProfileInput(profiles, "super-bot")?.id).toBe("super_bot");
  });

  test("returns undefined for ambiguous input", () => {
    expect(resolveProfileInput(profiles, "profile")).toBeUndefined();
  });

  test("matches slugified profile names and near slug typos", () => {
    const scoped = [
      { id: "gary", name: "Gary Vee", model: null, isDefault: false, isSuper: false },
    ];

    expect(resolveProfileInput(scoped, "gary-vee")?.id).toBe("gary");
    expect(resolveProfileInput(scoped, "garry-vee")?.id).toBe("gary");
    expect(slugifyProfileName("Gary Vee")).toBe("gary-vee");
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

describe("resolveProfileInScopes", () => {
  test("finds a profile in a specific org scope", () => {
    const result = resolveProfileInScopes(
      [
        {
          orgId: "org_a",
          orgName: "Acme",
          profiles: [{ id: "default", name: "Default Bot", model: null, isDefault: true, isSuper: false }],
        },
        {
          orgId: "org_b",
          orgName: "Beta",
          profiles: [{ id: "gary", name: "Gary Vee", model: null, isDefault: true, isSuper: false }],
        },
      ],
      "gary-vee",
    );

    expect(result).not.toBeNull();
    expect(result && "scope" in result && result.scope.orgId).toBe("org_b");
    expect(result && "profile" in result && result.profile.name).toBe("Gary Vee");
  });
});

describe("formatProfileSelectionPrompt", () => {
  test("shows explicit switch examples", () => {
    const prompt = formatProfileSelectionPrompt(profiles, "profile_a", "Personal");

    expect(prompt).toContain("Switch with /profile 2, /profile <id>, or /profile <name>");
  });
});
