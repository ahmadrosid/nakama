import { describe, expect, test } from "bun:test";
import { matchSkillsForMessage } from "./match";
import type { DiscoveredSkill } from "./types";

const weatherSkill: DiscoveredSkill = {
  body: "Use the weather tool.",
  description: "Get weather forecasts. Use when the user asks about weather.",
  directory: "/tmp/weather",
  disableModelInvocation: false,
  hasTool: true,
  includeBodyOnMatch: false,
  name: "weather",
  scriptIssues: [],
  scriptTools: [],
  skillFilePath: "/tmp/weather/SKILL.md",
  toolPath: "/tmp/weather/tool.ts",
};

const privateSkill: DiscoveredSkill = {
  ...weatherSkill,
  description: "Deploy the app to production.",
  disableModelInvocation: true,
  name: "deploy",
};

describe("matchSkillsForMessage", () => {
  test("matches by keyword in user message", () => {
    const matched = matchSkillsForMessage(
      [weatherSkill],
      "What's the weather in Jakarta?"
    );

    expect(matched.map((skill) => skill.name)).toEqual(["weather"]);
  });

  test("matches explicit /skill invocation", () => {
    const matched = matchSkillsForMessage(
      [privateSkill],
      "Please /skill deploy now"
    );

    expect(matched.map((skill) => skill.name)).toEqual(["deploy"]);
  });

  test("skips explicit-only skills without invocation", () => {
    const matched = matchSkillsForMessage(
      [privateSkill],
      "deploy the app to production"
    );

    expect(matched).toEqual([]);
  });

  test("matches a singular word against a plural description keyword", () => {
    const artifactSkill: DiscoveredSkill = {
      ...weatherSkill,
      description: "Create or save artifacts and dashboards.",
      name: "artifact-design",
    };

    expect(
      matchSkillsForMessage(
        [artifactSkill],
        "can you make me a dashboard artifact for Q3?"
      ).map((skill) => skill.name)
    ).toEqual(["artifact-design"]);
  });

  test("ignores words inside a pasted URL", () => {
    const installerSkill: DiscoveredSkill = {
      ...weatherSkill,
      description:
        "Find, list, and install reusable skills from GitHub or links.",
      name: "skill-installer",
    };

    expect(
      matchSkillsForMessage(
        [installerSkill],
        "hi can you clone this into your workspace https://github.com/LayerNorm/overlay-web"
      )
    ).toEqual([]);
    expect(
      matchSkillsForMessage(
        [installerSkill],
        "install the skill from GitHub https://github.com/o/r/tree/main/s"
      ).map((skill) => skill.name)
    ).toEqual(["skill-installer"]);
  });

  test("does not match on common words like find, list, or link", () => {
    const installerSkill: DiscoveredSkill = {
      ...weatherSkill,
      description: "Find, list, and link available things.",
      name: "skill-installer",
    };

    expect(
      matchSkillsForMessage(
        [installerSkill],
        "find the bug and list the open PRs, here is the link"
      )
    ).toEqual([]);
  });
});
