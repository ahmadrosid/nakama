import { describe, expect, test } from "bun:test";
import { generateSkillConsolidateMarkdown } from "./skill-consolidate";
import {
  buildSkillPostTurnReviewPrompt,
  parseSkillPostTurnReviewResponse,
} from "./skill-post-turn-review";
import { createCapturingProvider } from "./test-helpers";

describe("generateSkillConsolidateMarkdown", () => {
  test("skips generation when provider creation returns null", async () => {
    for (const mode of ["merge", "deslopify"] as const) {
      await expect(
        generateSkillConsolidateMarkdown({
          mode,
          provider: null,
          winner: {
            body: "Steps",
            description: "Deploy steps",
            name: "deploy",
          },
        })
      ).resolves.toBeNull();
    }
  });

  test.each([
    { content: "  Steps  ", expected: "Steps" },
    { content: "```markdown\nSteps\n```", expected: "Steps" },
    { content: " \n ", expected: null },
  ])("uses provider content: $expected", async ({ content, expected }) => {
    const provider = {
      ...createCapturingProvider({
        assistantMessage: { content: "", role: "assistant" },
        content: "",
        toolCalls: [],
      }),
      generateText: async () => ({ content }),
    };

    for (const mode of ["merge", "deslopify"] as const) {
      expect(
        await generateSkillConsolidateMarkdown({
          mode,
          provider,
          winner: {
            body: "Steps",
            description: "Deploy steps",
            name: "deploy",
          },
        })
      ).toBe(expected);
    }
  });
});

describe("parseSkillPostTurnReviewResponse", () => {
  const catalogNames = new Set(["deploy-checklist"]);

  test("accepts valid create", () => {
    const outcome = parseSkillPostTurnReviewResponse(
      JSON.stringify({
        action: "create",
        content:
          "---\nname: triage-support\ndescription: Triage tickets\n---\n\nSteps",
        name: "triage-support",
      }),
      { catalogNames }
    );

    expect(outcome).toEqual({
      action: "create",
      content:
        "---\nname: triage-support\ndescription: Triage tickets\n---\n\nSteps",
      name: "triage-support",
    });
  });

  test("accepts valid patch for known skill", () => {
    const outcome = parseSkillPostTurnReviewResponse(
      JSON.stringify({
        action: "patch",
        name: "deploy-checklist",
        newString: "step 1 updated",
        oldString: "step 1",
      }),
      { catalogNames }
    );

    expect(outcome.action).toBe("patch");
  });

  test("rejects delete", () => {
    expect(
      parseSkillPostTurnReviewResponse(
        JSON.stringify({ action: "delete", name: "x" }),
        {
          catalogNames,
        }
      )
    ).toEqual({ action: "noop", reason: "delete_forbidden" });
  });

  test("rejects bundled skill name", () => {
    expect(
      parseSkillPostTurnReviewResponse(
        JSON.stringify({
          action: "create",
          content: "---\nname: manage-skills\ndescription: x\n---\n",
          name: "manage-skills",
        }),
        { catalogNames }
      )
    ).toEqual({ action: "noop", reason: "bundled_forbidden" });
  });

  test("rejects malformed json", () => {
    expect(
      parseSkillPostTurnReviewResponse("not json", { catalogNames })
    ).toEqual({
      action: "noop",
      reason: "malformed_json",
    });
  });
});

describe("buildSkillPostTurnReviewPrompt", () => {
  test("includes catalog and turn tools", () => {
    const prompt = buildSkillPostTurnReviewPrompt({
      catalog: [{ description: "Deploy steps", name: "deploy-checklist" }],
      turnMessages: [
        { content: "deploy staging", role: "user" },
        {
          content: "ok",
          role: "assistant",
          toolCalls: [{ arguments: {}, id: "1", name: "bash" }],
        },
        { content: '{"ok":true}', name: "bash", role: "tool", toolCallId: "1" },
      ],
    });

    expect(prompt).toContain("deploy-checklist");
    expect(prompt).toContain("bash");
    expect(prompt).toContain("deploy staging");
  });
});
