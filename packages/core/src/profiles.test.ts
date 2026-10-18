import { describe, expect, test } from "bun:test";
import type { ProfileSummary } from "./contract";
import {
  filterProfilesForChatAccess,
  resolveProfileInput,
  resolveProfileInScopes,
  slugifyProfileName,
} from "./profiles";

const profileDefaults = {
  createdAt: "2026-01-01T00:00:00.000Z",
  hasAvatar: false,
  mcpServerCount: 0,
  soulActive: false,
  toolCount: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const profiles: ProfileSummary[] = [
  {
    ...profileDefaults,
    id: "profile_b",
    isDefault: false,
    isSuper: false,
    model: null,
    name: "Beta",
  },
  {
    ...profileDefaults,
    id: "profile_a",
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Alpha",
  },
  {
    ...profileDefaults,
    id: "super_nakama",
    isDefault: false,
    isSuper: true,
    model: null,
    name: "Super Nakama",
  },
];

describe("resolveProfileInput", () => {
  test("matches id, name, and list index", () => {
    expect(resolveProfileInput(profiles, "profile_b")?.id).toBe("profile_b");
    expect(resolveProfileInput(profiles, "Alpha")?.id).toBe("profile_a");
    expect(resolveProfileInput(profiles, "2")?.id).toBe("profile_b");
  });

  test("matches super nakama aliases", () => {
    expect(resolveProfileInput(profiles, "super_nakama")?.id).toBe(
      "super_nakama"
    );
    expect(resolveProfileInput(profiles, "super-nakama")?.id).toBe(
      "super_nakama"
    );
  });

  test("returns undefined for ambiguous input", () => {
    expect(resolveProfileInput(profiles, "profile")).toBeUndefined();
  });

  test("matches slugified profile names and near slug typos", () => {
    const scoped = [
      {
        ...profileDefaults,
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
  test("hides super nakama from org members and channel bridges", () => {
    expect(
      filterProfilesForChatAccess(profiles, { orgRole: "member" }).map(
        (profile) => profile.id
      )
    ).toEqual(["profile_b", "profile_a"]);
    expect(
      filterProfilesForChatAccess(profiles, {
        excludeSuperNakama: true,
        orgRole: "admin",
      }).map((profile) => profile.id)
    ).toEqual(["profile_b", "profile_a"]);
  });

  test("keeps super nakama for org admins", () => {
    expect(
      filterProfilesForChatAccess(profiles, { orgRole: "admin" }).map(
        (profile) => profile.id
      )
    ).toEqual(["profile_b", "profile_a", "super_nakama"]);
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
              ...profileDefaults,
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
              ...profileDefaults,
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
