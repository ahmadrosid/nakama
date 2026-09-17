import { describe, expect, test } from "bun:test";
import { parseProfileCreatedResult } from "./chat-stream";

const profile = {
  hasAvatar: false,
  id: "marketing-manager",
  isSuper: false,
  name: "Marketing Manager",
  updatedAt: "2026-09-16T11:00:08.619Z",
};

describe("parseProfileCreatedResult", () => {
  test("reads the marked profile result", () => {
    expect(
      parseProfileCreatedResult({ profile, type: "profile_created" })
    ).toMatchObject(profile);
  });

  test("keeps legacy create_profile results renderable", () => {
    expect(parseProfileCreatedResult({ profile })).toMatchObject(profile);
  });

  test("rejects other result types and incomplete profiles", () => {
    expect(
      parseProfileCreatedResult({ profile, type: "profile_updated" })
    ).toBeNull();
    expect(
      parseProfileCreatedResult({
        profile: { ...profile, id: undefined },
        type: "profile_created",
      })
    ).toBeNull();
  });
});
