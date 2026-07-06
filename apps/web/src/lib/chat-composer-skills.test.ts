import { describe, expect, test } from "bun:test";
import type { SkillSummary } from "@nakama/core/contract";
import {
  filterSkillsForSlashQuery,
  findActiveSkillSlashRange,
  getSkillTokenRanges,
  replaceSlashRangeWithSkillInvocation,
} from "./chat-composer-skills";

const weatherSkill = skill({
  id: "skill_weather",
  name: "weather",
  description: "Get weather forecasts.",
});

const deploySkill = skill({
  id: "skill_deploy",
  name: "deploy",
  description: "Deploy the app to production.",
  disableModelInvocation: true,
});

const createAutomationSkill = skill({
  id: "skill_create_automation",
  name: "create-automation",
  description: "Create and manage automations.",
});

const manageSkillsSkill = skill({
  id: "skill_manage_skills",
  name: "manage-skills",
  description: "Create and manage skills.",
});

function skill(overrides: Partial<SkillSummary>): SkillSummary {
  return {
    id: overrides.id ?? "skill_test",
    name: overrides.name ?? "test",
    description: overrides.description ?? "",
    sourcePath: overrides.sourcePath ?? "/tmp/test",
    hasTool: overrides.hasTool ?? false,
    disableModelInvocation: overrides.disableModelInvocation ?? false,
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? "2026-07-04T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-04T00:00:00.000Z",
  };
}

describe("findActiveSkillSlashRange", () => {
  test("finds slash query at the cursor", () => {
    expect(findActiveSkillSlashRange("/we", 3)).toEqual({
      start: 0,
      end: 3,
      query: "we",
    });
  });

  test("finds slash query after whitespace", () => {
    expect(findActiveSkillSlashRange("please /dep", 11)).toEqual({
      start: 7,
      end: 11,
      query: "dep",
    });
  });

  test("ignores slash after a word and slash ranges with whitespace", () => {
    expect(findActiveSkillSlashRange("https://nakama.test", 8)).toBeNull();
    expect(findActiveSkillSlashRange("/skill weather", 14)).toBeNull();
  });
});

describe("filterSkillsForSlashQuery", () => {
  test("returns all skills for an empty query", () => {
    expect(
      filterSkillsForSlashQuery(
        [weatherSkill, createAutomationSkill, manageSkillsSkill, deploySkill],
        "",
      ).map((s) => s.name),
    ).toEqual(["weather", "deploy"]);
  });

  test("filters by skill name or description", () => {
    expect(filterSkillsForSlashQuery([weatherSkill, deploySkill], "wea")).toEqual([
      weatherSkill,
    ]);
    expect(filterSkillsForSlashQuery([weatherSkill, deploySkill], "production")).toEqual([
      deploySkill,
    ]);
  });

  test("hides bundled management skills even when they match the query", () => {
    expect(
      filterSkillsForSlashQuery([createAutomationSkill, manageSkillsSkill, weatherSkill], "create"),
    ).toEqual([]);
    expect(
      filterSkillsForSlashQuery(
        [createAutomationSkill, manageSkillsSkill, weatherSkill],
        "manage",
      ),
    ).toEqual([]);
  });
});

describe("replaceSlashRangeWithSkillInvocation", () => {
  test("replaces only the active slash range", () => {
    const range = findActiveSkillSlashRange("please /we tomorrow", 10);
    expect(range).not.toBeNull();

    expect(replaceSlashRangeWithSkillInvocation("please /we tomorrow", range!, weatherSkill)).toEqual({
      value: "please /skill weather  tomorrow",
      cursorIndex: 22,
    });
  });
});

describe("getSkillTokenRanges", () => {
  test("detects explicit skill invocations for highlighting", () => {
    expect(getSkillTokenRanges("/skill weather please")).toEqual([
      { start: 0, end: 14, name: "weather" },
    ]);
    expect(getSkillTokenRanges("please /skill deploy now")).toEqual([
      { start: 7, end: 20, name: "deploy" },
    ]);
  });

  test("does not create token ranges for partial invocations", () => {
    expect(getSkillTokenRanges("/skill ")).toEqual([]);
  });
});
