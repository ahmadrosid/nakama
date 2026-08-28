import { describe, expect, test } from "bun:test";
import {
  resolveProfileOrgBooleanOverride,
  resolveSkillCuratorConsolidateEnabled,
  resolveSkillPostTurnReviewEnabled,
  resolveSkillWriteApprovalRequired,
} from "./profile-org-override";

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

describe("resolveSkillWriteApprovalRequired", () => {
  test("defaults to false when org and profile unset", () => {
    expect(resolveSkillWriteApprovalRequired({})).toBe(false);
  });

  test("org true enables gate when profile inherits", () => {
    expect(
      resolveSkillWriteApprovalRequired({
        orgSkillsWriteApproval: true,
        profileSkillsWriteApproval: null,
      })
    ).toBe(true);
  });

  test("profile false overrides org true (AE7)", () => {
    expect(
      resolveSkillWriteApprovalRequired({
        orgSkillsWriteApproval: true,
        profileSkillsWriteApproval: false,
      })
    ).toBe(false);
  });

  test("profile true forces gate on when org false", () => {
    expect(
      resolveSkillWriteApprovalRequired({
        orgSkillsWriteApproval: false,
        profileSkillsWriteApproval: true,
      })
    ).toBe(true);
  });
});

describe("resolveSkillPostTurnReviewEnabled", () => {
  test("defaults to false when org and profile unset", () => {
    expect(resolveSkillPostTurnReviewEnabled({})).toBe(false);
  });

  test("org true enables when profile inherits", () => {
    expect(
      resolveSkillPostTurnReviewEnabled({
        orgSkillsPostTurnReview: true,
        profileSkillsPostTurnReview: null,
      })
    ).toBe(true);
  });

  test("profile false overrides org true", () => {
    expect(
      resolveSkillPostTurnReviewEnabled({
        orgSkillsPostTurnReview: true,
        profileSkillsPostTurnReview: false,
      })
    ).toBe(false);
  });

  test("profile true forces on when org false", () => {
    expect(
      resolveSkillPostTurnReviewEnabled({
        orgSkillsPostTurnReview: false,
        profileSkillsPostTurnReview: true,
      })
    ).toBe(true);
  });
});

describe("resolveSkillCuratorConsolidateEnabled", () => {
  test("defaults to false when org and profile unset", () => {
    expect(resolveSkillCuratorConsolidateEnabled({})).toBe(false);
  });

  test("org true enables when profile inherits", () => {
    expect(
      resolveSkillCuratorConsolidateEnabled({
        orgSkillsCuratorConsolidateEnabled: true,
        profileSkillsCuratorConsolidateEnabled: null,
      })
    ).toBe(true);
  });

  test("profile false overrides org true", () => {
    expect(
      resolveSkillCuratorConsolidateEnabled({
        orgSkillsCuratorConsolidateEnabled: true,
        profileSkillsCuratorConsolidateEnabled: false,
      })
    ).toBe(false);
  });

  test("profile true forces on when org false", () => {
    expect(
      resolveSkillCuratorConsolidateEnabled({
        orgSkillsCuratorConsolidateEnabled: false,
        profileSkillsCuratorConsolidateEnabled: true,
      })
    ).toBe(true);
  });
});
