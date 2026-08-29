import { describe, expect, test } from "bun:test";
import { formatErrorLines } from "./chat";
import { normalizeStyledLine, styledLine, styledLineText } from "./styled-text";
import { printLine } from "./terminal-safe";

describe("CLI ANSI sanitization", () => {
  test("normalizeStyledLine strips escape sequences from plain strings", () => {
    const line = normalizeStyledLine("hi\x1b[31mRED\x1b[0m\x1b[2J");
    expect(styledLineText(line)).toBe("hiRED");
  });

  test("styledLine strips escape sequences from segment text", () => {
    const line = styledLine("evil\x1b[2Jname", { dim: true });
    expect(styledLineText(line)).toBe("evilname");
  });

  test("formatErrorLines strips ANSI from error messages", () => {
    const lines = formatErrorLines(new Error("fail\x1b[31mred\x1b[0m"));
    expect(lines.join("\n")).not.toContain("\x1b");
    expect(lines.join("\n")).toContain("failred");
  });

  test("printLine strips ANSI before console.log", () => {
    const original = console.log;
    const calls: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      printLine("ok\x1b[2J");
      expect(calls).toEqual([["ok"]]);
    } finally {
      console.log = original;
    }
  });
});
