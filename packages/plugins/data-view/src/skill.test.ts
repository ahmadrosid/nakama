import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type DiscoveredSkill,
  matchSkillsForMessage,
  parseSkillMarkdown,
} from "@nakama/core";

const path = new URL("../skills/data-view/SKILL.md", import.meta.url);

const parsed = parseSkillMarkdown(readFileSync(path, "utf8"), path.pathname);

const skill: DiscoveredSkill = {
  body: parsed.body,
  description: parsed.frontmatter.description,
  directory: "",
  disableModelInvocation: false,
  hasTool: false,
  includeBodyOnMatch: true,
  name: parsed.frontmatter.name,
  scriptIssues: [],
  scriptTools: [],
  skillFilePath: path.pathname,
  toolPath: null,
};

test.each([
  "Can you enrich this Fian Candidate Management.xlsx file with a new column",
  "how many rows are in the hiring spreadsheet?",
  "check this https://docs.google.com/spreadsheets/d/abc/edit",
])("the Data View skill reaches the agent for %p", (message) => {
  expect(matchSkillsForMessage([skill], message)).toEqual([skill]);
});

test("the Data View skill stays out of unrelated requests", () => {
  expect(
    matchSkillsForMessage([skill], "write a haiku about the ocean")
  ).toEqual([]);
});
