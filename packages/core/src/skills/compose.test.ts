import { describe, expect, test } from "bun:test";
import {
  composeAgentBrowserCapabilityPrompt,
  composeMatchedSkillsPrompt,
  composeSkillsCatalog,
} from "./compose";
import { matchSkillsForMessage } from "./match";
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
    expect(prompt).toContain(baseSkill.skillFilePath);
    expect(prompt).toContain(baseSkill.directory);
  });

  test("includes body when includeBodyOnMatch is true", () => {
    const prompt = composeMatchedSkillsPrompt([
      { ...baseSkill, includeBodyOnMatch: true },
    ]);

    expect(prompt).toContain("Call the weather tool with a city name.");
    expect(prompt).toContain(baseSkill.skillFilePath);
  });

  test("includes body on explicit invocation regardless of flag", () => {
    const prompt = composeMatchedSkillsPrompt([baseSkill], {
      explicitInvocation: true,
    });

    expect(prompt).toContain("Call the weather tool with a city name.");
    expect(prompt).toContain(baseSkill.skillFilePath);
  });
});

describe("composeAgentBrowserCapabilityPrompt", () => {
  test("returns empty string when agent-browser is not assigned", () => {
    expect(composeAgentBrowserCapabilityPrompt([{ name: "weather" }])).toBe("");
    expect(composeAgentBrowserCapabilityPrompt([])).toBe("");
  });
});

describe("skill instruction discovery", () => {
  test("catalog exposes the instruction file for available skills", () => {
    expect(composeSkillsCatalog([baseSkill])).toContain(
      baseSkill.skillFilePath
    );
  });

  test("natural-language Bang-Motion request gets its instruction location", () => {
    const skill = {
      ...baseSkill,
      body: "Read references/explainer.md before creating the animation.",
      directory: "/tmp/skills/bang-motion",
      name: "bang-motion",
      skillFilePath: "/tmp/skills/bang-motion/SKILL.md",
    };
    const matched = matchSkillsForMessage(
      [skill],
      "Buatkan explainer tentang kereta Whoosh sekitar 1 menit\nstyle vector gunakan skill Bang-Motion"
    );
    expect(matched).toHaveLength(1);
    const prompt = composeMatchedSkillsPrompt(matched);
    expect(prompt).toContain(skill.skillFilePath);
    expect(prompt).toContain(skill.directory);
    expect(prompt).not.toContain(skill.body);
  });
});
