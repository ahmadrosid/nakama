import { describe, expect, test } from "bun:test";
import type { SkillSummary } from "@nakama/core/contract";
import {
  type ComposerSlashSuggestion,
  filterComposerMentionSuggestions,
  filterComposerSlashSuggestions,
  filterReservedSlashCommands,
  filterSkillsForSlashQuery,
  findActiveSkillSlashRange,
  getLeadingCommand,
  getMentionTokenRanges,
  getReservedCommandTokenRanges,
  getSkillTokenRanges,
  matchComposerBtwCommand,
  matchComposerOpenCommand,
  replaceSlashRangeWithReservedCommand,
} from "./chat-composer-skills";

const openPlugins = [
  { label: "Data View", pluginId: "data-view" },
  { label: "Workflows", pluginId: "workflows" },
];

function suggestionName(item: ComposerSlashSuggestion): string {
  if (item.kind === "command") {
    return item.command.name;
  }

  return item.kind === "plugin" ? item.plugin.pluginId : item.skill.name;
}

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

describe("findActiveSkillSlashRange", () => {});

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
  test.each([
    ["addto", "add-tool"],
    ["ADD_TO", "add-tool"],
    ["adtl", "add-tool"],
  ])("matches command query %s", (query, name) => {
    const commands = filterComposerSlashSuggestions([], query, {
      enableAddCommands: true,
    }).filter((item) => item.kind === "command");

    expect(commands.map((item) => item.command.name)).toEqual([name]);
    expect(filterComposerSlashSuggestions([], query)).toEqual([]);
  });

  test("ranks contiguous matches ahead of scattered letters", () => {
    const commands = ["add-tool", "atlas"].map((name) => ({
      description: "",
      name,
    }));

    expect(
      filterReservedSlashCommands("atl", commands).map((c) => c.name)
    ).toEqual(["atlas", "add-tool"]);
    expect(filterReservedSlashCommands("zzzz", commands)).toEqual([]);
  });

  test("lists add commands only when enabled", () => {
    expect(
      filterComposerSlashSuggestions([weatherSkill], "add").filter(
        (item) => item.kind === "command"
      )
    ).toEqual([]);
    expect(
      filterComposerSlashSuggestions([weatherSkill], "add", {
        enableAddCommands: true,
      }).map(suggestionName)
    ).toEqual(["add-plugin", "add-tool", "add-mcp", "add-skill"]);
    expect(
      filterComposerSlashSuggestions([weatherSkill], "add-t", {
        enableAddCommands: true,
      }).map(suggestionName)
    ).toEqual(["add-tool"]);
  });
});

describe("/btw side chat command", () => {
  test("returns the question, or empty for a bare command", () => {
    expect(matchComposerBtwCommand("/btw what is RAG?")).toBe("what is RAG?");
    expect(matchComposerBtwCommand("  /btw  ")).toBe("");
    expect(matchComposerBtwCommand("/btw line one\nline two")).toBe(
      "line one\nline two"
    );
    expect(matchComposerBtwCommand("/btwx")).toBeNull();
    expect(matchComposerBtwCommand("please /btw")).toBeNull();
  });
});

describe("matchComposerLearningLoopCommand", () => {});

describe("replaceSlashRangeWithSkillInvocation", () => {});

describe("replaceSlashRangeWithReservedCommand", () => {});

describe("getSkillTokenRanges", () => {
  test("does not create token ranges for partial invocations", () => {
    expect(getSkillTokenRanges("/skill ")).toEqual([]);
  });
});

describe("getReservedCommandTokenRanges", () => {
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

describe("@ mentions", () => {
  test("offers @image and inserts it with a trailing space", () => {
    const [suggestion] = filterComposerMentionSuggestions("im");
    expect(suggestion).toMatchObject({
      kind: "mention",
      mention: { name: "image" },
    });
    expect(filterComposerMentionSuggestions("john")).toEqual([]);

    const range = findActiveSkillSlashRange("@im", 3, "@");
    expect(
      replaceSlashRangeWithReservedCommand(
        "@im",
        range!,
        { name: "image" },
        "@"
      )
    ).toEqual({ cursorIndex: 7, value: "@image " });
  });

  test("highlights @image tokens only as whole words", () => {
    expect(getMentionTokenRanges("@image a fox, then @image again")).toEqual([
      { end: 6, name: "image", start: 0 },
      { end: 25, name: "image", start: 19 },
    ]);
    expect(getMentionTokenRanges("me@image.dev @images")).toEqual([]);
  });
});

describe("getLeadingCommand", () => {
  test("finds a leading skill after whitespace and ignores later tokens", () => {
    const found = getLeadingCommand("  /skill weather /skill missing", [
      weatherSkill,
    ]);

    expect(found?.range).toEqual({ end: 16, name: "weather", start: 2 });
    expect(found?.description).toBe(weatherSkill.description.trim());
  });
});

describe("/open plugin command", () => {
  test("lists the agent's plugins while typing /open and narrows by name", () => {
    const names = (query: string) =>
      filterComposerSlashSuggestions([weatherSkill], query, {
        openPlugins,
      }).map(suggestionName);

    expect(names("op")).toEqual(["data-view", "workflows"]);
    expect(names("open data")).toEqual(["data-view"]);
    expect(names("open work")).toEqual(["workflows"]);
    expect(names("wea")).toEqual(["weather"]);
    expect(names("")).toEqual(["weather"]);
  });

  test("a sent /open matches a plugin by id or label", () => {
    expect(matchComposerOpenCommand("/open data-view", openPlugins)).toEqual(
      openPlugins[0]
    );
    expect(matchComposerOpenCommand(" /open Workflows ", openPlugins)).toEqual(
      openPlugins[1]
    );
    expect(matchComposerOpenCommand("/open notes", openPlugins)).toBeNull();
    expect(
      matchComposerOpenCommand("please /open data-view", openPlugins)
    ).toBeNull();
  });
});
