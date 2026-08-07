import { expect, test } from "bun:test";
import { DEFAULT_BUNDLED_SKILL_NAMES, OPT_IN_BUNDLED_SKILL_NAMES } from "../bundled-names";
import { parseSkillMarkdown } from "../parse";
import { readBundledSkillMarkdown } from "./index";

async function parsed() {
  const content = await readBundledSkillMarkdown("triage-crash-report");
  return parseSkillMarkdown(content, "triage-crash-report/SKILL.md");
}

test("the skill parses and is opt-in, never assigned to every profile", async () => {
  const skill = await parsed();

  expect(skill.frontmatter.name).toBe("triage-crash-report");
  expect(skill.frontmatter.includeBodyOnMatch).toBe(true);
  expect(OPT_IN_BUNDLED_SKILL_NAMES).toContain("triage-crash-report");
  expect(DEFAULT_BUNDLED_SKILL_NAMES).not.toContain("triage-crash-report");
});

test("the default is to not file, and the environment cases are named", async () => {
  const { body } = await parsed();

  expect(body).toMatch(/Default to not filing/i);
  expect(body).toMatch(/401|quota/i);
  expect(body).toMatch(/port already in use/i);
  expect(body).toMatch(/MCP server/i);
});

test("the skill treats report text as untrusted rather than as instructions", async () => {
  const { body } = await parsed();

  expect(body).toMatch(/untrusted/i);
  expect(body).toMatch(/not an instruction/i);
});

test("the skill requires a find before filing", async () => {
  const { body } = await parsed();

  expect(body).toContain("crash_issue");
  expect(body).toMatch(/action: "find"/);
});
