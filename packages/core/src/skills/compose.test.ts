import { describe, expect, test } from "bun:test";
import {
  composeAgentBrowserCapabilityPrompt,
  composeLoadedSkillPrompt,
  composeSkillsCatalog,
} from "./compose";
import type { DiscoveredSkill } from "./types";

const baseSkill: DiscoveredSkill = {
  body: "Call the weather tool with a city name.",
  description: "Get weather forecasts.",
  directory: "/tmp/weather",
  disableModelInvocation: false,
  hasTool: true,
  name: "weather",
  scriptIssues: [],
  scriptTools: [],
  skillFilePath: "/tmp/weather/SKILL.md",
  toolPath: "/tmp/weather/tool.ts",
};

describe("composeLoadedSkillPrompt", () => {
  test("includes the body and where to resolve references", () => {
    const prompt = composeLoadedSkillPrompt(baseSkill);

    expect(prompt).toContain("Call the weather tool with a city name.");
    expect(prompt).toContain(baseSkill.skillFilePath);
    expect(prompt).toContain(baseSkill.directory);
  });
});

describe("composeSkillsCatalog", () => {
  test("lists model-loadable skills and leaves out /skill-only skills", () => {
    const catalog = composeSkillsCatalog([
      baseSkill,
      { ...baseSkill, disableModelInvocation: true, name: "deploy" },
    ]);

    expect(catalog).toContain("**weather**");
    expect(catalog).not.toContain("**deploy**");
    expect(catalog).not.toContain(baseSkill.body);
  });

  test("is empty when every skill is /skill-only", () => {
    expect(
      composeSkillsCatalog([{ ...baseSkill, disableModelInvocation: true }])
    ).toBe("");
  });
});

describe("composeAgentBrowserCapabilityPrompt", () => {
  test("returns empty string when agent-browser is not assigned", () => {
    expect(composeAgentBrowserCapabilityPrompt([{ name: "weather" }])).toBe("");
    expect(composeAgentBrowserCapabilityPrompt([])).toBe("");
  });

  test("adds the live browser workflow only when the cloud browser is on", () => {
    const skills = [{ name: "agent-browser" }];
    const local = composeAgentBrowserCapabilityPrompt(skills);

    const cloud = composeAgentBrowserCapabilityPrompt(skills, {
      cloudBrowser: true,
    });

    expect(local).not.toBe("");
    expect(cloud.length).toBeGreaterThan(local.length);
    expect(cloud.startsWith(local)).toBe(true);
  });
});

describe("skills that ship code nothing can run", () => {
  const stranded: DiscoveredSkill = {
    ...baseSkill,
    hasTool: false,
    name: "order-pricing",
    scriptIssues: [
      { path: "scripts/pricing.py", reason: "not runnable: name it tool.py" },
    ],
    toolPath: null,
  };

  test("more than one is counted, not listed", () => {
    const line = composeSkillsCatalog([
      {
        ...stranded,
        scriptIssues: [
          ...stranded.scriptIssues,
          {
            path: "scripts/report.py",
            reason: "not runnable: name it tool.py",
          },
        ],
      },
    ]);

    expect(line).toContain("ships 2 scripts that cannot run here");
  });
});
