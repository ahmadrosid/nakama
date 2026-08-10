import { describe, expect, test } from "bun:test";
import type { SkillSummary } from "@nakama/core/contract";
import {
  filterSkillsForSlashQuery,
  findActiveSkillSlashRange,
  getSkillTokenRanges,
  replaceSlashRangeWithSkillInvocation,
} from "./chat-composer-skills";

const weatherSkill = skill({
  description: "Get weather forecasts.",
  id: "skill_weather",
  name: "weather",
});

const deploySkill = skill({
  description: "Deploy the app to production.",
  disableModelInvocation: true,
  id: "skill_deploy",
  name: "deploy",
});

const createAutomationSkill = skill({
  description: "Create and manage automations.",
  id: "skill_create_automation",
  name: "create-automation",
});

const manageSkillsSkill = skill({
  description: "Create and manage skills.",
  id: "skill_manage_skills",
  name: "manage-skills",
});

function skill(overrides: Partial<SkillSummary>): SkillSummary {
  return {
    createdAt: overrides.createdAt ?? "2026-07-04T00:00:00.000Z",
    createdBy: overrides.createdBy ?? "bundled",
    description: overrides.description ?? "",
    disableModelInvocation: overrides.disableModelInvocation ?? false,
    enabled: overrides.enabled ?? true,
    hasTool: overrides.hasTool ?? false,
    id: overrides.id ?? "skill_test",
    name: overrides.name ?? "test",
    sourcePath: overrides.sourcePath ?? "/tmp/test",
    updatedAt: overrides.updatedAt ?? "2026-07-04T00:00:00.000Z",
  };
}

describe("findActiveSkillSlashRange", () => {
  test("finds slash query at the cursor", () => {
    expect(findActiveSkillSlashRange("/we", 3)).toEqual({
      end: 3,
      query: "we",
      start: 0,
    });
  });

  test("finds slash query after whitespace", () => {
    expect(findActiveSkillSlashRange("please /dep", 11)).toEqual({
      end: 11,
      query: "dep",
      start: 7,
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
        ""
      ).map((s) => s.name)
    ).toEqual(["weather", "deploy"]);
  });

  test("filters by skill name or description", () => {
    expect(
      filterSkillsForSlashQuery([weatherSkill, deploySkill], "wea")
    ).toEqual([weatherSkill]);
    expect(
      filterSkillsForSlashQuery([weatherSkill, deploySkill], "production")
    ).toEqual([deploySkill]);
  });

  test("hides bundled management skills even when they match the query", () => {
    expect(
      filterSkillsForSlashQuery(
        [createAutomationSkill, manageSkillsSkill, weatherSkill],
        "create"
      )
    ).toEqual([]);
    expect(
      filterSkillsForSlashQuery(
        [createAutomationSkill, manageSkillsSkill, weatherSkill],
        "manage"
      )
    ).toEqual([]);
  });
});

describe("replaceSlashRangeWithSkillInvocation", () => {
  test("replaces only the active slash range", () => {
    const range = findActiveSkillSlashRange("please /we tomorrow", 10);
    expect(range).not.toBeNull();

    expect(
      replaceSlashRangeWithSkillInvocation(
        "please /we tomorrow",
        range!,
        weatherSkill
      )
    ).toEqual({
      cursorIndex: 22,
      value: "please /skill weather  tomorrow",
    });
  });
});

describe("getSkillTokenRanges", () => {
  test("detects explicit skill invocations for highlighting", () => {
    expect(getSkillTokenRanges("/skill weather please")).toEqual([
      { end: 14, name: "weather", start: 0 },
    ]);
    expect(getSkillTokenRanges("please /skill deploy now")).toEqual([
      { end: 20, name: "deploy", start: 7 },
    ]);
  });

  test("does not create token ranges for partial invocations", () => {
    expect(getSkillTokenRanges("/skill ")).toEqual([]);
  });
});
