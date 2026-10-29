import { describe, expect, test } from "bun:test";
import { resolveProfileOrgBooleanOverride } from "./profile-org-override";

describe("resolveProfileOrgBooleanOverride", () => {
  test("falls back to the org, then to false", () => {
    expect(resolveProfileOrgBooleanOverride(undefined, undefined)).toBe(false);
    expect(resolveProfileOrgBooleanOverride(null, true)).toBe(true);
  });

  test("profile wins over org", () => {
    expect(resolveProfileOrgBooleanOverride(false, true)).toBe(false);
    expect(resolveProfileOrgBooleanOverride(true, false)).toBe(true);
  });
});
