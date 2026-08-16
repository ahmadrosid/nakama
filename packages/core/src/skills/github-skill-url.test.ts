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

  test("rejects encoded path separators that could escape owner/repo", () => {
    expect(() =>
      resolveGitHubSkillRawUrl(
        "https://github.com/trusted-org/skills/blob/main/..%2F..%2F..%2Fattacker%2Fevil%2Fmain%2FSKILL.md"
      )
    ).toThrow(/encoded path separators/i);
  });

  test("rejects encoded hash that would become a fragment after decode", () => {
    expect(() =>
      resolveGitHubSkillRawUrl(
        "https://github.com/acme/skills/blob/main/we%23ird/SKILL.md"
      )
    ).toThrow(/encoded path separators/i);
  });

  test("URL-normalized .. stays within the declared owner/repo", () => {
    // `new URL` collapses literal `..` before we parse segments, so this
    // becomes blob/attacker/SKILL.md under trusted-org/skills — same repo.
    const resolved = resolveGitHubSkillRawUrl(
      "https://github.com/trusted-org/skills/blob/main/../attacker/SKILL.md"
    );
    expect(resolved).toBe(
      "https://raw.githubusercontent.com/trusted-org/skills/attacker/SKILL.md"
    );
    expect(resolved.includes("/../")).toBe(false);
  });
});
