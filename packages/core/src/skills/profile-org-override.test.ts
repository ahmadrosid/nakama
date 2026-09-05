import { describe, expect, test } from "bun:test";
import { resolveProfileOrgBooleanOverride } from "./profile-org-override";

describe("resolveProfileOrgBooleanOverride", () => {
  test("defaults to false when both unset", () => {
    expect(resolveProfileOrgBooleanOverride(undefined, undefined)).toBe(false);
  });

  test("org true when profile inherits", () => {
    expect(resolveProfileOrgBooleanOverride(null, true)).toBe(true);
  });

  test("profile wins over org", () => {
    expect(resolveProfileOrgBooleanOverride(false, true)).toBe(false);
    expect(resolveProfileOrgBooleanOverride(true, false)).toBe(true);
  });
});
