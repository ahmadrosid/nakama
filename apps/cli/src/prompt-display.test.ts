import { describe, expect, test } from "bun:test";
import {
  formatInputForDisplay,
  normalizePastedText,
  splitInputDisplayLines,
} from "./prompt-display";

describe("formatInputForDisplay", () => {
  test("keeps real newlines", () => {
    expect(formatInputForDisplay("line one\nline two")).toBe("line one\nline two");
  });

  test("normalizes carriage returns", () => {
    expect(formatInputForDisplay("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("normalizePastedText", () => {
  test("normalizes Windows line endings", () => {
    expect(normalizePastedText("a\r\nb\r\nc")).toBe("a\nb\nc");
  });
});

describe("splitInputDisplayLines", () => {
  test("returns a single empty line for empty input", () => {
    expect(splitInputDisplayLines("", 2, 80)).toEqual([""]);
  });

  test("wraps long input across terminal width", () => {
    expect(splitInputDisplayLines("abcdefghij", 2, 6)).toEqual(["abcd", "efgh", "ij"]);
  });

  test("accounts for prompt prefix on wrapped lines", () => {
    expect(splitInputDisplayLines("1234567890", 4, 8)).toEqual(["1234", "5678", "90"]);
  });

  test("splits on explicit newlines", () => {
    expect(splitInputDisplayLines("hello\nworld", 2, 80)).toEqual(["hello", "world"]);
  });

  test("preserves blank lines", () => {
    expect(splitInputDisplayLines("a\n\nb", 2, 80)).toEqual(["a", "", "b"]);
  });

  test("does not split ansi escape sequences when wrapping", () => {
    const lines = splitInputDisplayLines("\x1b[31mabcdef\x1b[0m", 2, 6);

    expect(lines).toEqual(["\x1b[31mabcd\x1b[0m", "\x1b[31mef\x1b[0m"]);
  });

  test("wraps wide characters by visible width", () => {
    const lines = splitInputDisplayLines("中文中文", 2, 6);

    expect(lines).toEqual(["中文", "中文"]);
  });
});
