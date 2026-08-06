import { describe, expect, test } from "bun:test";
import { resolveSkillPostTurnReviewEnabled } from "./post-turn-review";

describe("resolveSkillPostTurnReviewEnabled", () => {
  test("defaults to false when org and profile unset", () => {
    expect(resolveSkillPostTurnReviewEnabled({})).toBe(false);
  });

  test("org true enables review when profile inherits", () => {
    expect(
      resolveSkillPostTurnReviewEnabled({
        orgSkillsPostTurnReview: true,
        profileSkillsPostTurnReview: null,
      }),
    ).toBe(true);
  });

  test("profile false overrides org true", () => {
    expect(
      resolveSkillPostTurnReviewEnabled({
        orgSkillsPostTurnReview: true,
        profileSkillsPostTurnReview: false,
      }),
    ).toBe(false);
  });

  test("profile true forces review on when org false", () => {
    expect(
      resolveSkillPostTurnReviewEnabled({
        orgSkillsPostTurnReview: false,
        profileSkillsPostTurnReview: true,
      }),
    ).toBe(true);
  });
});
