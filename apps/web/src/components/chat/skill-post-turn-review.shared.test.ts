import { describe, expect, test } from "bun:test";
import type { SkillSuggestion } from "@nakama/core/contract";
import {
  extractSkillDescription,
  skillSuggestionPreview,
} from "./skill-post-turn-review.shared";

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

describe("skillSuggestionPreview", () => {
  test("create uses frontmatter description", () => {
    const preview = skillSuggestionPreview(
      suggestion({
        content: `---
name: deploy-notes
description: Run the deploy checklist.
---

# Steps
1. Build
`,
      })
    );
    expect(preview.title).toContain("deploy-notes");
    expect(preview.description).toBe("Run the deploy checklist.");
    expect(preview.excerpt).toContain("Steps");
  });

  test("patch shows replace excerpt", () => {
    const preview = skillSuggestionPreview(
      suggestion({
        action: "patch",
        patchNewString: "new step",
        patchOldString: "old step",
      })
    );
    expect(preview.title).toContain("Update");
    expect(preview.excerpt).toContain("old step");
    expect(preview.excerpt).toContain("new step");
  });
});

describe("extractSkillDescription", () => {
  test("returns null without frontmatter", () => {
    expect(extractSkillDescription("# Hello")).toBeNull();
  });
});
