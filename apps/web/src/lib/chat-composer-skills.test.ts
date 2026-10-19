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
  matchComposerAddCommand,
  matchComposerBtwCommand,
  matchComposerLearningLoopCommand,
  matchComposerOpenCommand,
  replaceSlashRangeWithReservedCommand,
  replaceSlashRangeWithSkillInvocation,
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
  test.each([
    ["addto", "add-tool"],
    ["ADD_TO", "add-tool"],
    ["add-pl", "add-plugin"],
    ["addpl", "add-plugin"],
    ["addmc", "add-mcp"],
    ["adtl", "add-tool"],
    ["tool", "add-tool"],
  ])("matches command query %s", (query, name) => {
    const commands = filterComposerSlashSuggestions([], query, {
      enableAddCommands: true,
    }).filter((item) => item.kind === "command");

    expect(commands.map((item) => item.command.name)).toEqual([name]);
    expect(filterComposerSlashSuggestions([], query)).toEqual([]);
  });

  test("does not turn separator-only input into every command", () => {
    expect(
      filterComposerSlashSuggestions([], "-_", { enableAddCommands: true })
    ).toEqual([]);
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
  test("lists reserved /learn ahead of skills when manage-skills is assigned", () => {
    expect(
      filterComposerSlashSuggestions([manageSkillsSkill, weatherSkill], "").map(
        suggestionName
      )
    ).toEqual(["enable-learning-loop", "learn", "weather"]);
  });

  test("hides /learn when manage-skills is not assigned", () => {
    expect(
      filterComposerSlashSuggestions([weatherSkill, deploySkill], "").map(
        suggestionName
      )
    ).toEqual(["weather", "deploy"]);
    expect(filterComposerSlashSuggestions([weatherSkill], "lea")).toEqual([]);
  });

  test("matches /learn by name prefix only", () => {
    const suggestions = filterComposerSlashSuggestions(
      [manageSkillsSkill, weatherSkill, deploySkill],
      "lea"
    );

    expect(
      suggestions.map((item) => item.kind === "command" && item.command.name)
    ).toEqual(["learn", "enable-learning-loop"]);
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

describe("matchComposerAddCommand", () => {
  test("matches a bare add command", () => {
    expect(matchComposerAddCommand("  /add-tool  ")).toBe("add-tool");
    expect(matchComposerAddCommand("/add-mcp")).toBe("add-mcp");
    expect(matchComposerAddCommand("/add-plugin")).toBe("add-plugin");
    expect(matchComposerAddCommand("/add-skill")).toBe("add-skill");
    expect(matchComposerAddCommand("/add-plugin workflows")).toBeNull();
    expect(matchComposerAddCommand("/add-tool please")).toBeNull();
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

  test("is listed only when enabled", () => {
    const names = (enableBtw: boolean) =>
      filterComposerSlashSuggestions([], "bt", { enableBtw }).map(
        (suggestion) =>
          suggestion.kind === "command" ? suggestion.command.name : null
      );

    expect(names(true)).toContain("btw");
    expect(names(false)).not.toContain("btw");
  });
});

describe("matchComposerLearningLoopCommand", () => {
  test("matches the bare learning loop command", () => {
    expect(matchComposerLearningLoopCommand("  /enable-learning-loop  ")).toBe(
      true
    );
    expect(matchComposerLearningLoopCommand("/enable-learning-loop now")).toBe(
      false
    );
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

describe("@ mentions", () => {
  test("opens on @ at a word start, never inside an email", () => {
    expect(findActiveSkillSlashRange("draw @im", 8, "@")).toEqual({
      end: 8,
      query: "im",
      start: 5,
    });
    expect(findActiveSkillSlashRange("me@image.dev", 12, "@")).toBeNull();
  });

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
  test("finds a leading reserved command", () => {
    const found = getLeadingCommand("/enable-learning-loop now", [
      manageSkillsSkill,
    ]);

    expect(found?.range).toEqual({
      end: 21,
      name: "enable-learning-loop",
      start: 0,
    });
  });

  test("finds a leading skill token", () => {
    const found = getLeadingCommand("/skill weather rain?", [weatherSkill]);

    expect(found?.range.name).toBe("weather");
    expect(found?.description).toBe(weatherSkill.description.trim());
  });

  test("keeps the first matching skill when names repeat", () => {
    const duplicate = { ...weatherSkill, description: "Second skill" };

    const found = getLeadingCommand("/skill weather", [
      weatherSkill,
      duplicate,
    ]);

    expect(found?.description).toBe(weatherSkill.description.trim());
  });

  test("ignores later skills when the leading skill is unavailable", () => {
    expect(
      getLeadingCommand("/skill missing /skill weather", [weatherSkill])
    ).toBeNull();
  });

  test("finds a leading skill after whitespace and ignores later tokens", () => {
    const found = getLeadingCommand("  /skill weather /skill missing", [
      weatherSkill,
    ]);

    expect(found?.range).toEqual({ end: 16, name: "weather", start: 2 });
    expect(found?.description).toBe(weatherSkill.description.trim());
  });

  test("ignores a command mid-sentence", () => {
    expect(getLeadingCommand("run /skill weather", [weatherSkill])).toBeNull();
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

  test("keeps the picker open after the space in /open", () => {
    expect(findActiveSkillSlashRange("/open dat", 9)).toEqual({
      end: 9,
      query: "open dat",
      start: 0,
    });
    expect(findActiveSkillSlashRange("/learn dat", 10)).toBeNull();
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
