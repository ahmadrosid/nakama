import { describe, expect, test } from "bun:test";
import {
  composeAgentBrowserCapabilityPrompt,
  composeMatchedSkillsPrompt,
} from "./compose";
import type { DiscoveredSkill } from "./types";

const baseSkill: DiscoveredSkill = {
  body: "Call the weather tool with a city name.",
  description: "Get weather forecasts.",
  directory: "/tmp/weather",
  disableModelInvocation: false,
  hasTool: true,
  includeBodyOnMatch: false,
  name: "weather",
  skillFilePath: "/tmp/weather/SKILL.md",
  toolPath: "/tmp/weather/tool.ts",
};

describe("composeMatchedSkillsPrompt", () => {
  test("omits body when body-on-match is disabled", () => {
    const prompt = composeMatchedSkillsPrompt([baseSkill]);

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

describe("composeAgentBrowserCapabilityPrompt", () => {
  test("returns empty string when agent-browser is not assigned", () => {
    expect(composeAgentBrowserCapabilityPrompt([{ name: "weather" }])).toBe("");
    expect(composeAgentBrowserCapabilityPrompt([])).toBe("");
  });
});
