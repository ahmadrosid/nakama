import { describe, expect, test } from "bun:test";
import { parseSkillMarkdown } from "./parse";

describe("parseSkillMarkdown", () => {
  test("parses frontmatter and body", () => {
    const parsed = parseSkillMarkdown(
      `---
name: weather
description: Get weather forecasts. Use when the user asks about weather.
---

# Weather

Call the weather tool with a city name.
`,
      "/tmp/skills/weather/SKILL.md"
    );

    expect(parsed.frontmatter.name).toBe("weather");
    expect(parsed.frontmatter.description).toContain("weather forecasts");
    expect(parsed.body).toContain("# Weather");
  });

  test("rejects missing frontmatter", () => {
    expect(() =>
      parseSkillMarkdown("# No frontmatter", "/tmp/SKILL.md")
    ).toThrow("YAML frontmatter");
  });
});
