import { describe, expect, test } from "bun:test";
import { composeMatchedSkillsPrompt } from "./compose";
import type { DiscoveredSkill } from "./types";

const baseSkill: DiscoveredSkill = {
  name: "weather",
  description: "Get weather forecasts.",
  disableModelInvocation: false,
  includeBodyOnMatch: false,
  directory: "/tmp/weather",
  skillFilePath: "/tmp/weather/SKILL.md",
  body: "Call the weather tool with a city name.",
  hasTool: true,
  toolPath: "/tmp/weather/tool.ts",
};

describe("composeMatchedSkillsPrompt", () => {
  test("includes description only when body-on-match is disabled", () => {
    const prompt = composeMatchedSkillsPrompt([baseSkill]);

    expect(prompt).toContain("Active Skill: weather");
    expect(prompt).toContain("Get weather forecasts.");
    expect(prompt).not.toContain("Call the weather tool");
  });

  test("includes body when includeBodyOnMatch is true", () => {
    const prompt = composeMatchedSkillsPrompt([
      { ...baseSkill, includeBodyOnMatch: true },
    ]);

    expect(prompt).toContain("Call the weather tool with a city name.");
  });

  test("includes body on explicit invocation regardless of flag", () => {
    const prompt = composeMatchedSkillsPrompt([baseSkill], {
      explicitInvocation: true,
    });

    expect(prompt).toContain("Call the weather tool with a city name.");
  });
});
