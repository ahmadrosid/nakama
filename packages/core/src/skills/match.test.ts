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

  test("matches inserted explicit-only composer invocation", () => {
    const matched = matchSkillsForMessage(
      [weatherSkill, privateSkill],
      "/skill deploy "
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
});
