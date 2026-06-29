import { describe, expect, test } from "bun:test";
import type { DiscoveredSkill } from "./types";
import { matchSkillsForMessage } from "./match";

const weatherSkill: DiscoveredSkill = {
  name: "weather",
  description: "Get weather forecasts. Use when the user asks about weather.",
  disableModelInvocation: false,
  includeBodyOnMatch: false,
  directory: "/tmp/weather",
  skillFilePath: "/tmp/weather/SKILL.md",
  body: "Use the weather tool.",
  hasTool: true,
  toolPath: "/tmp/weather/tool.ts",
};

const privateSkill: DiscoveredSkill = {
  ...weatherSkill,
  name: "deploy",
  description: "Deploy the app to production.",
  disableModelInvocation: true,
};

describe("matchSkillsForMessage", () => {
  test("matches by keyword in user message", () => {
    const matched = matchSkillsForMessage([weatherSkill], "What's the weather in Jakarta?");
    expect(matched.map((skill) => skill.name)).toEqual(["weather"]);
  });

  test("matches explicit /skill invocation", () => {
    const matched = matchSkillsForMessage(
      [privateSkill],
      "Please /skill deploy now",
    );
    expect(matched.map((skill) => skill.name)).toEqual(["deploy"]);
  });

  test("skips explicit-only skills without invocation", () => {
    const matched = matchSkillsForMessage(
      [privateSkill],
      "deploy the app to production",
    );
    expect(matched).toEqual([]);
  });
});
