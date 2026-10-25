import { describe, expect, test } from "bun:test";
import { normalizeStyledLine, styledLine, styledLineText } from "./styled-text";

describe("CLI ANSI sanitization", () => {
  test("normalizeStyledLine strips escape sequences from plain strings", () => {
    const line = normalizeStyledLine("hi\x1b[31mRED\x1b[0m\x1b[2J");
    expect(styledLineText(line)).toBe("hiRED");
  });

  test("styledLine strips escape sequences from segment text", () => {
    const line = styledLine("evil\x1b[2Jname", { dim: true });
    expect(styledLineText(line)).toBe("evilname");
  });
});
