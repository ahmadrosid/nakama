import { describe, expect, test } from "bun:test";
import {
  BAD_OUTPUTS_TEMPLATE,
  GOOD_OUTPUTS_TEMPLATE,
  INSTRUCTIONS_TEMPLATE,
  SOUL_TEMPLATE,
  STYLE_TEMPLATE,
} from "./templates";

const PLACEHOLDER_PATTERN = /\[[^\]]+\]/;

describe("default soul templates", () => {
  test("SOUL_TEMPLATE is a filled Default Bot identity", () => {
    expect(SOUL_TEMPLATE).toContain("# Default Bot");
    expect(SOUL_TEMPLATE).toContain("## Values");
    expect(SOUL_TEMPLATE).toContain("## Boundaries");
    expect(SOUL_TEMPLATE).toContain("## Continuity & Sessions");
    expect(SOUL_TEMPLATE).not.toContain("# Your Name");
    expect(SOUL_TEMPLATE).not.toMatch(PLACEHOLDER_PATTERN);
    expect(SOUL_TEMPLATE.length).toBeLessThan(4000);
  });

  test("companion templates avoid bracket placeholders", () => {
    for (const template of [
      STYLE_TEMPLATE,
      INSTRUCTIONS_TEMPLATE,
      GOOD_OUTPUTS_TEMPLATE,
      BAD_OUTPUTS_TEMPLATE,
    ]) {
      expect(template).not.toMatch(PLACEHOLDER_PATTERN);
    }
  });

  test("example templates include complete prompt/response blocks", () => {
    expect(GOOD_OUTPUTS_TEMPLATE).toContain("**Prompt:**");
    expect(GOOD_OUTPUTS_TEMPLATE).toContain("**Response:**");
    expect(BAD_OUTPUTS_TEMPLATE).toContain("**Bad response:**");
    expect(BAD_OUTPUTS_TEMPLATE).toContain("**Why it's wrong:**");
  });
});
