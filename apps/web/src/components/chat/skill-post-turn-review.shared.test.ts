import { describe, expect, test } from "bun:test";
import type { SkillSuggestion } from "@nakama/core/contract";
import { extractSkillDescription } from "./skill-post-turn-review.shared";

function suggestion(partial: Partial<SkillSuggestion>): SkillSuggestion {
  return {
    action: "create",
    appliedAt: null,
    content: null,
    createdAt: "2026-08-04T00:00:00.000Z",
    id: "sug_1",
    orgId: "org_1",
    patchNewString: null,
    patchOldString: null,
    profileId: "profile_1",
    proposedByUserId: "user_1",
    sessionId: "sess_1",
    skillName: "deploy-notes",
    source: "post_turn_review",
    status: "pending",
    ...partial,
  };
}

describe("extractSkillDescription", () => {
  test("returns null without frontmatter", () => {
    expect(extractSkillDescription("# Hello")).toBeNull();
  });
});
