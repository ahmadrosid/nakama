import { describe, expect, test } from "bun:test";
import type { ProfileSummary } from "@nakama/core";
import {
  formatProfileLine,
  parseCliProfileArgs,
  resolveProfileInput,
  sortProfilesForPicker,
} from "./profile";

function profile(
  overrides: Partial<ProfileSummary> & Pick<ProfileSummary, "id" | "name">
): ProfileSummary {
  return {
    createdAt: "",
    hasAvatar: false,
    isSuper: false,
    mcpServerCount: 0,
    model: null,
    soulActive: false,
    toolCount: 0,
    updatedAt: "",
    ...overrides,
  };
}

const sampleProfiles = [
  profile({ id: "super_bot", isSuper: true, name: "Super Bot" }),
  profile({ id: "profile_default", isDefault: true, name: "Default Bot" }),
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
    expect(resolveProfileInput(sampleProfiles, "profile_custom")?.name).toBe(
      "Research Bot"
    );
    expect(resolveProfileInput(sampleProfiles, "Super Bot")?.id).toBe(
      "super_bot"
    );
    expect(resolveProfileInput(sampleProfiles, "1")?.id).toBe(
      "profile_default"
    );
  });

  test("returns undefined for unknown input", () => {
    expect(resolveProfileInput(sampleProfiles, "missing")).toBeUndefined();
  });
});

describe("formatProfileLine", () => {
  test("strips ANSI from profile name and id", () => {
    const formatted = formatProfileLine(
      profile({ id: "id_\x1b[31mx", name: "Bot\x1b[2J" }),
      0
    );
    expect(formatted).not.toContain("\x1b");
    expect(formatted).toContain("Bot");
    expect(formatted).toContain("id_x");
  });
});
