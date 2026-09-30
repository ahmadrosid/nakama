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
  scriptIssues: [],
  scriptTools: [],
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
      scriptIssues: [],
      scriptTools: [],
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

  test("the catalog says the scripts cannot run", () => {
    const line = composeSkillsCatalog([stranded]);

    expect(line).toContain("ships 1 script that cannot run here");
    expect(line).toContain("do not answer from their source");
  });

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

  test("a skill with a working tool is unchanged", () => {
    expect(composeSkillsCatalog([baseSkill])).toContain("(includes tool)");
    expect(composeSkillsCatalog([baseSkill])).not.toContain("cannot run here");
  });

  test("a prose-only skill with no scripts stays silent", () => {
    const prose = { ...baseSkill, hasTool: false, toolPath: null };
    const line = composeSkillsCatalog([prose]);

    expect(line).not.toContain("cannot run here");
    expect(line).not.toContain("(includes tool)");
  });
});
