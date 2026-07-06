import { describe, expect, test } from "bun:test";
import type { ProfileSummary } from "@nakama/core";
import {
  parseCliProfileArgs,
  resolveProfileInput,
  sortProfilesForPicker,
} from "./profile";

function profile(overrides: Partial<ProfileSummary> & Pick<ProfileSummary, "id" | "name">): ProfileSummary {
  return {
    model: null,
    isSuper: false,
    toolCount: 0,
    mcpServerCount: 0,
    soulActive: false,
    hasAvatar: false,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const sampleProfiles = [
  profile({ id: "super_bot", name: "Super Bot", isSuper: true }),
  profile({ id: "profile_default", name: "Default Bot", isDefault: true }),
  profile({ id: "profile_custom", name: "Research Bot" }),
];

describe("parseCliProfileArgs", () => {
  test("reads --profile and -p", () => {
    expect(parseCliProfileArgs(["--profile", "profile_custom"])).toEqual({
      profileId: "profile_custom",
    });
    expect(parseCliProfileArgs(["-p", "super_bot"])).toEqual({
      profileId: "super_bot",
    });
  });

  test("reads --profile=value", () => {
    expect(parseCliProfileArgs(["--profile=profile_default"])).toEqual({
      profileId: "profile_default",
    });
  });
});

describe("sortProfilesForPicker", () => {
  test("puts default profile first", () => {
    const sorted = sortProfilesForPicker(sampleProfiles);
    expect(sorted[0]?.id).toBe("profile_default");
  });
});

describe("resolveProfileInput", () => {
  test("resolves id, name, and index", () => {
    expect(resolveProfileInput(sampleProfiles, "profile_custom")?.name).toBe("Research Bot");
    expect(resolveProfileInput(sampleProfiles, "Super Bot")?.id).toBe("super_bot");
    expect(resolveProfileInput(sampleProfiles, "1")?.id).toBe("profile_default");
  });

  test("returns undefined for unknown input", () => {
    expect(resolveProfileInput(sampleProfiles, "missing")).toBeUndefined();
  });
});
