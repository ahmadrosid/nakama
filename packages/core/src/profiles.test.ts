import { describe, expect, test } from "bun:test";
import type { ProfileSummary } from "./contract";
import {
  filterProfilesForChatAccess,
  resolveProfileInput,
  resolveProfileInScopes,
  slugifyProfileName,
} from "./profiles";

const profiles: ProfileSummary[] = [
  {
    id: "profile_b",
    isDefault: false,
    isSuper: false,
    model: null,
    name: "Beta",
  },
  {
    id: "profile_a",
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Alpha",
  },
  {
    id: "super_bot",
    isDefault: false,
    isSuper: true,
    model: null,
    name: "Super Bot",
  },
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
      {
        id: "gary",
        isDefault: false,
        isSuper: false,
        model: null,
        name: "Gary Vee",
      },
    ];

    expect(resolveProfileInput(scoped, "gary-vee")?.id).toBe("gary");
    expect(resolveProfileInput(scoped, "garry-vee")?.id).toBe("gary");
    expect(slugifyProfileName("Gary Vee")).toBe("gary-vee");
  });
});

describe("filterProfilesForChatAccess", () => {
  test("hides super bot from org members and channel bridges", () => {
    expect(
      filterProfilesForChatAccess(profiles, { orgRole: "member" }).map(
        (profile) => profile.id
      )
    ).toEqual(["profile_b", "profile_a"]);
    expect(
      filterProfilesForChatAccess(profiles, {
        excludeSuperBot: true,
        orgRole: "admin",
      }).map((profile) => profile.id)
    ).toEqual(["profile_b", "profile_a"]);
  });

  test("keeps super bot for org admins", () => {
    expect(
      filterProfilesForChatAccess(profiles, { orgRole: "admin" }).map(
        (profile) => profile.id
      )
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
          profiles: [
            {
              id: "default",
              isDefault: true,
              isSuper: false,
              model: null,
              name: "Default Bot",
            },
          ],
        },
        {
          orgId: "org_b",
          orgName: "Beta",
          profiles: [
            {
              id: "gary",
              isDefault: true,
              isSuper: false,
              model: null,
              name: "Gary Vee",
            },
          ],
        },
      ],
      "gary-vee"
    );

    expect(result).not.toBeNull();
    expect(result && "scope" in result && result.scope.orgId).toBe("org_b");
    expect(result && "profile" in result && result.profile.name).toBe(
      "Gary Vee"
    );
  });
});
