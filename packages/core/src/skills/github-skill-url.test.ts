import { describe, expect, test } from "bun:test";
import { resolveGitHubSkillRawUrl } from "./github-skill-url";

describe("resolveGitHubSkillRawUrl", () => {
  test("rewrites blob URLs to raw.githubusercontent.com", () => {
    expect(
      resolveGitHubSkillRawUrl(
        "https://github.com/acme/skills/blob/main/weather/SKILL.md"
      )
    ).toBe(
      "https://raw.githubusercontent.com/acme/skills/main/weather/SKILL.md"
    );
  });

  test("rewrites tree folder URLs by appending SKILL.md", () => {
    expect(
      resolveGitHubSkillRawUrl(
        "https://github.com/acme/skills/tree/main/weather"
      )
    ).toBe(
      "https://raw.githubusercontent.com/acme/skills/main/weather/SKILL.md"
    );
  });

  test("accepts raw.githubusercontent.com SKILL.md URLs", () => {
    expect(
      resolveGitHubSkillRawUrl(
        "https://raw.githubusercontent.com/acme/skills/main/weather/SKILL.md"
      )
    ).toBe(
      "https://raw.githubusercontent.com/acme/skills/main/weather/SKILL.md"
    );
  });

  test("accepts github.com raw URLs", () => {
    expect(
      resolveGitHubSkillRawUrl(
        "https://github.com/acme/skills/raw/main/weather/SKILL.md"
      )
    ).toBe(
      "https://raw.githubusercontent.com/acme/skills/main/weather/SKILL.md"
    );
  });

  test("rejects non-GitHub hosts", () => {
    expect(() =>
      resolveGitHubSkillRawUrl("https://example.com/weather/SKILL.md")
    ).toThrow(/Only public GitHub URLs/);
  });

  test("rejects blob URLs that are not SKILL.md", () => {
    expect(() =>
      resolveGitHubSkillRawUrl(
        "https://github.com/acme/skills/blob/main/weather/README.md"
      )
    ).toThrow(/SKILL\.md/);
  });
});
