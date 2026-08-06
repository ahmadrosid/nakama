import { describe, expect, test } from "bun:test";
import {
  AGENT_BROWSER_SKILL_NAME,
  composeAgentBrowserCapabilityPrompt,
  composeMatchedSkillsPrompt,
} from "./compose";
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
  test("returns capability guidance when agent-browser is assigned", () => {
    const prompt = composeAgentBrowserCapabilityPrompt([
      { name: AGENT_BROWSER_SKILL_NAME },
    ]);

    expect(prompt).toContain("agent-browser skill");
    expect(prompt).toContain("Available Agent Skills");
    expect(prompt).toContain("Skills are workflow instructions");
    expect(prompt).toContain("/skill agent-browser");
    expect(prompt).toContain("screenshot artifacts/");
    expect(prompt).toContain("web_fetch");
  });

  test("returns empty string when agent-browser is not assigned", () => {
    expect(composeAgentBrowserCapabilityPrompt([{ name: "weather" }])).toBe("");
    expect(composeAgentBrowserCapabilityPrompt([])).toBe("");
  });
});
