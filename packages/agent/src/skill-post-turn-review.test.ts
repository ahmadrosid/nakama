import { describe, expect, test } from "bun:test";
import {
  buildSkillPostTurnReviewPrompt,
  parseSkillPostTurnReviewResponse,
} from "./skill-post-turn-review";

describe("parseSkillPostTurnReviewResponse", () => {
  const catalogNames = new Set(["deploy-checklist"]);

  test("accepts valid create", () => {
    const outcome = parseSkillPostTurnReviewResponse(
      JSON.stringify({
        action: "create",
        name: "triage-support",
        content: "---\nname: triage-support\ndescription: Triage tickets\n---\n\nSteps",
      }),
      { catalogNames },
    );
    expect(outcome).toEqual({
      action: "create",
      name: "triage-support",
      content: "---\nname: triage-support\ndescription: Triage tickets\n---\n\nSteps",
    });
  });

  test("accepts valid patch for known skill", () => {
    const outcome = parseSkillPostTurnReviewResponse(
      JSON.stringify({
        action: "patch",
        name: "deploy-checklist",
        oldString: "step 1",
        newString: "step 1 updated",
      }),
      { catalogNames },
    );
    expect(outcome.action).toBe("patch");
  });

  test("rejects delete", () => {
    expect(
      parseSkillPostTurnReviewResponse(JSON.stringify({ action: "delete", name: "x" }), {
        catalogNames,
      }),
    ).toEqual({ action: "noop", reason: "delete_forbidden" });
  });

  test("rejects bundled skill name", () => {
    expect(
      parseSkillPostTurnReviewResponse(
        JSON.stringify({
          action: "create",
          name: "manage-skills",
          content: "---\nname: manage-skills\ndescription: x\n---\n",
        }),
        { catalogNames },
      ),
    ).toEqual({ action: "noop", reason: "bundled_forbidden" });
  });

  test("rejects malformed json", () => {
    expect(parseSkillPostTurnReviewResponse("not json", { catalogNames })).toEqual({
      action: "noop",
      reason: "malformed_json",
    });
  });
});

describe("buildSkillPostTurnReviewPrompt", () => {
  test("includes catalog and turn tools", () => {
    const prompt = buildSkillPostTurnReviewPrompt({
      catalog: [{ name: "deploy-checklist", description: "Deploy steps" }],
      turnMessages: [
        { role: "user", content: "deploy staging" },
        {
          role: "assistant",
          content: "ok",
          toolCalls: [{ id: "1", name: "bash", arguments: "{}" }],
        },
        { role: "tool", toolCallId: "1", name: "bash", content: '{"ok":true}' },
      ],
    });
    expect(prompt).toContain("deploy-checklist");
    expect(prompt).toContain("bash");
    expect(prompt).toContain("deploy staging");
  });
});
