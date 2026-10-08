import { describe, expect, test } from "bun:test";
import {
  buildConsolidatePlan,
  classifyConsolidateEligibility,
  jaccardOverlap,
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

describe("jaccardOverlap", () => {
  test("returns 0 for disjoint sets", () => {
    expect(jaccardOverlap(new Set(["a", "b"]), new Set(["c", "d"]))).toBe(0);
  });

  test("returns 1 for identical sets", () => {
    expect(jaccardOverlap(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
  });
});

describe("classifyConsolidateEligibility", () => {
  test("skips non-agent skills", () => {
    expect(
      classifyConsolidateEligibility({
        skill: agentSkill("x", "desc", { createdBy: "human" }),
      })
    ).toBe("not_agent");
  });

  test("skips bundled skill names", () => {
    expect(
      classifyConsolidateEligibility({
        skill: agentSkill("manage-skills", "desc"),
      })
    ).toBe("bundled");
  });

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

  test("skips pending proposal names and automation profiles", () => {
    expect(
      classifyConsolidateEligibility({
        pendingSkillNames: new Set(["foo"]),
        skill: agentSkill("foo", "bar"),
      })
    ).toBe("pending_proposal");

    expect(
      classifyConsolidateEligibility({
        hasEnabledAutomation: true,
        skill: agentSkill("foo", "bar"),
      })
    ).toBe("automation_profile");
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

  test("does not cluster low-overlap agent skills", () => {
    const plan = buildConsolidatePlan({
      now: NOW,
      skills: [
        agentSkill("invoice-parser", "parse vendor invoices from pdf"),
        agentSkill("calendar-sync", "sync google calendar events daily"),
      ],
    });

    expect(plan.clusters).toHaveLength(0);
    expect(plan.solos).toHaveLength(0);
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
