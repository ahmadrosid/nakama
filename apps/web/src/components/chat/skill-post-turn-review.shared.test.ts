import { describe, expect, test } from "bun:test";
import { extractSkillDescription } from "./skill-post-turn-review.shared";

describe("extractSkillDescription", () => {
  test("returns null without frontmatter", () => {
    expect(extractSkillDescription("# Hello")).toBeNull();
  });
});
