import { describe, expect, test } from "bun:test";
import path from "node:path";
import { discoverSkillDirectory } from "./discover";
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
  scriptIssues: [],
  scriptTools: [],
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

  test("skips explicit-only skills without invocation", () => {
    const matched = matchSkillsForMessage(
      [privateSkill],
      "deploy the app to production"
    );

    expect(matched).toEqual([]);
  });

  test("matches a singular word against a plural description keyword", () => {
    const artifactSkill: DiscoveredSkill = {
      ...weatherSkill,
      description: "Create or save artifacts and dashboards.",
      name: "artifact-design",
    };

    expect(
      matchSkillsForMessage(
        [artifactSkill],
        "can you make me a dashboard artifact for Q3?"
      ).map((skill) => skill.name)
    ).toEqual(["artifact-design"]);
  });

  test("ignores words inside a pasted URL", () => {
    const installerSkill: DiscoveredSkill = {
      ...weatherSkill,
      description:
        "Find, list, and install reusable skills from GitHub or links.",
      name: "skill-installer",
    };

    expect(
      matchSkillsForMessage(
        [installerSkill],
        "hi can you clone this into your workspace https://github.com/LayerNorm/overlay-web"
      )
    ).toEqual([]);
    expect(
      matchSkillsForMessage(
        [installerSkill],
        "install the skill from GitHub https://github.com/o/r/tree/main/s"
      ).map((skill) => skill.name)
    ).toEqual(["skill-installer"]);
  });

  test("does not match on common words like find, list, or link", () => {
    const installerSkill: DiscoveredSkill = {
      ...weatherSkill,
      description: "Find, list, and link available things.",
      name: "skill-installer",
    };

    expect(
      matchSkillsForMessage(
        [installerSkill],
        "find the bug and list the open PRs, here is the link"
      )
    ).toEqual([]);
  });

  test("ignores bare-domain and www links", () => {
    const githubSkill: DiscoveredSkill = {
      ...weatherSkill,
      description: "Work with GitHub repositories.",
      name: "gh-helper",
    };

    for (const message of [
      "clone github.com/LayerNorm/overlay-web please",
      "clone www.github.com/LayerNorm/overlay-web please",
    ]) {
      expect(matchSkillsForMessage([githubSkill], message)).toEqual([]);
    }
  });

  test("keeps words glued to the end of a link", () => {
    const installerSkill: DiscoveredSkill = {
      ...weatherSkill,
      description: "Install reusable skills.",
      name: "skill-installer",
    };

    expect(
      matchSkillsForMessage(
        [installerSkill],
        "see [repo](https://example.com/o/r),install"
      ).map((skill) => skill.name)
    ).toEqual(["skill-installer"]);
  });

  test("does not match plural forms of stop words", () => {
    const ticketSkill: DiscoveredSkill = {
      ...weatherSkill,
      description: "Finds and lists things.",
      name: "ticket-helper",
    };

    expect(
      matchSkillsForMessage([ticketSkill], "find the bug and list the PRs")
    ).toEqual([]);
  });

  test("bundled skill-installer ignores everyday link messages", async () => {
    const installer = await discoverSkillDirectory(
      path.join(import.meta.dir, "bundled", "skill-installer")
    );

    if (!installer) {
      throw new Error("bundled skill-installer not found");
    }

    for (const message of [
      "summarize this article https://example.com/post",
      "check this website for me",
      "clone github.com/LayerNorm/overlay-web",
    ]) {
      expect(matchSkillsForMessage([installer], message)).toEqual([]);
    }

    expect(
      matchSkillsForMessage(
        [installer],
        "install the skill from https://github.com/o/r"
      )
    ).toHaveLength(1);
  });
});
