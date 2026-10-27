import { describe, expect, test } from "bun:test";
import {
  buildConsolidatePlan,
  classifyConsolidateEligibility,
  SKILL_CONSOLIDATE_MAX_SOLOS_PER_RUN,
  SKILL_CONSOLIDATE_RECENT_PATCH_MS,
  SKILL_CONSOLIDATE_VERBOSE_CHAR_THRESHOLD,
  skillTokenSet,
} from "./consolidate";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function agentSkill(
  name: string,
  description: string,
  extras: Partial<{
    body: string;
    createdBy: string;
    sourcePath: string;
  }> = {}
) {
  return {
    body: extras.body ?? "",
    createdBy: extras.createdBy ?? "agent",
    description,
    id: `skill_${name}`,
    name,
    sourcePath:
      extras.sourcePath ??
      `/tmp/nakama/orgs/o1/profiles/p1/skills/${name}/SKILL.md`,
  };
}

describe("jaccardOverlap", () => {});

describe("classifyConsolidateEligibility", () => {
  test("skips recent patches; null patched is eligible", () => {
    expect(
      classifyConsolidateEligibility({
        now: NOW,
        skill: {
          ...agentSkill("foo", "bar"),
          lastPatchedAt: new Date(
            NOW.getTime() - SKILL_CONSOLIDATE_RECENT_PATCH_MS / 2
          ).toISOString(),
        },
      })
    ).toBe("recent_patch");

    expect(
      classifyConsolidateEligibility({
        now: NOW,
        skill: { ...agentSkill("foo", "bar"), lastPatchedAt: null },
      })
    ).toBeNull();
  });
});

describe("buildConsolidatePlan", () => {
  test("clusters overlapping agent skills and ranks by use count", () => {
    const high = {
      ...agentSkill(
        "deploy-helper",
        "deploy production release checklist helper"
      ),
      lastUsedAt: "2026-08-01T00:00:00.000Z",
      useCount: 10,
    };

    const low = {
      ...agentSkill(
        "deploy-assistant",
        "deploy production release checklist assistant"
      ),
      lastUsedAt: "2026-07-01T00:00:00.000Z",
      useCount: 1,
    };

    const plan = buildConsolidatePlan({ now: NOW, skills: [low, high] });

    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0]?.winner.name).toBe("deploy-helper");
    expect(plan.clusters[0]?.losers.map((item) => item.name)).toEqual([
      "deploy-assistant",
    ]);
  });

  test("lists verbose solo skills and skips budget-exhausted extras", () => {
    const verboseBody = "x".repeat(SKILL_CONSOLIDATE_VERBOSE_CHAR_THRESHOLD);

    const topics = [
      "invoice parser pdf vendor",
      "calendar sync google events",
      "slack notifier channel alerts",
      "github pr review comments",
    ];

    const skills = topics.map((description, index) =>
      agentSkill(`verbose-${index}`, description, {
        body: verboseBody,
      })
    );

    const plan = buildConsolidatePlan({ now: NOW, skills });

    expect(plan.clusters).toHaveLength(0);
    expect(plan.solos).toHaveLength(SKILL_CONSOLIDATE_MAX_SOLOS_PER_RUN);
    expect(plan.budgetExhausted).toBe(true);
  });

  test("never includes human or bundled skills in clusters", () => {
    const plan = buildConsolidatePlan({
      now: NOW,
      skills: [
        agentSkill("deploy-helper", "deploy production release checklist"),
        agentSkill("deploy-assistant", "deploy production release checklist", {
          createdBy: "human",
        }),
        agentSkill("manage-skills", "deploy production release checklist"),
      ],
    });

    expect(plan.clusters).toHaveLength(0);
    expect(plan.skippedCount).toBe(2);
  });

  test("skillTokenSet includes name and description tokens", () => {
    const tokens = skillTokenSet({
      body: "",
      createdBy: "agent",
      description: "Hello World",
      id: "skill_hello",
      name: "hello-skill",
      sourcePath: "/tmp/x",
    });

    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("skill")).toBe(true);
  });
});
