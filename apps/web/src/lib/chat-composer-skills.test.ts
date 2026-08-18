import { describe, expect, test } from "bun:test";
import type { SkillSummary } from "@nakama/core/contract";
import {
  filterComposerSlashSuggestions,
  filterSkillsForSlashQuery,
  findActiveSkillSlashRange,
  getReservedCommandTokenRanges,
  getSkillTokenRanges,
  replaceSlashRangeWithReservedCommand,
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

describe("filterComposerSlashSuggestions", () => {
  test("lists reserved /learn ahead of skills when manage-skills is assigned", () => {
    expect(
      filterComposerSlashSuggestions([manageSkillsSkill, weatherSkill], "").map(
        (item) =>
          item.kind === "command" ? item.command.name : item.skill.name
      )
    ).toEqual(["learn", "weather"]);
  });

  test("hides /learn when manage-skills is not assigned", () => {
    expect(
      filterComposerSlashSuggestions([weatherSkill, deploySkill], "").map(
        (item) =>
          item.kind === "command" ? item.command.name : item.skill.name
      )
    ).toEqual(["weather", "deploy"]);
    expect(filterComposerSlashSuggestions([weatherSkill], "lea")).toEqual([]);
  });

  test("matches /learn by name prefix only", () => {
    const suggestions = filterComposerSlashSuggestions(
      [manageSkillsSkill, weatherSkill, deploySkill],
      "lea"
    );
    expect(suggestions).toEqual([
      {
        command: {
          description: "Distill a reusable skill from sources",
          name: "learn",
        },
        kind: "command",
      },
    ]);
  });

  test("does not match /learn via description keywords", () => {
    expect(
      filterComposerSlashSuggestions(
        [manageSkillsSkill, weatherSkill],
        "re"
      ).filter((item) => item.kind === "command")
    ).toEqual([]);
    expect(
      filterComposerSlashSuggestions(
        [manageSkillsSkill, weatherSkill],
        "sk"
      ).filter((item) => item.kind === "command")
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

describe("replaceSlashRangeWithReservedCommand", () => {
  test("inserts /learn without the /skill prefix", () => {
    const range = findActiveSkillSlashRange("/lea", 4);
    expect(range).not.toBeNull();

    expect(
      replaceSlashRangeWithReservedCommand("/lea", range!, {
        name: "learn",
      })
    ).toEqual({
      cursorIndex: 7,
      value: "/learn ",
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

describe("getReservedCommandTokenRanges", () => {
  test("highlights a leading /learn command", () => {
    expect(getReservedCommandTokenRanges("/learn filing an expense")).toEqual([
      { end: 6, name: "learn", start: 0 },
    ]);
  });

  test("highlights a bare /learn command", () => {
    expect(getReservedCommandTokenRanges("/learn")).toEqual([
      { end: 6, name: "learn", start: 0 },
    ]);
  });

  test("does not highlight when learn is disabled for the profile", () => {
    expect(
      getReservedCommandTokenRanges("/learn filing", { enableLearn: false })
    ).toEqual([]);
  });

  test("does not highlight /learn embedded in other words or paths", () => {
    expect(getReservedCommandTokenRanges("/learning to code")).toEqual([]);
    expect(getReservedCommandTokenRanges("https://x/learn")).toEqual([]);
    expect(getReservedCommandTokenRanges("tell me about /learn later")).toEqual(
      []
    );
  });
});
