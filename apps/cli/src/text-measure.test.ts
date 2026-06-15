import { describe, expect, test } from "bun:test";
import {
  getCharWidth,
  stripAnsi,
  tokenizeText,
  truncateText,
  visibleLength,
  wrapText,
} from "./text-measure";

describe("getCharWidth", () => {
  test("ascii characters are width 1", () => {
    expect(getCharWidth("a")).toBe(1);
    expect(getCharWidth("1")).toBe(1);
    expect(getCharWidth(" ")).toBe(1);
  });

  test("combining marks are zero width", () => {
    expect(getCharWidth("\u0301")).toBe(0);
  });

  test("cjk characters are width 2", () => {
    expect(getCharWidth("中")).toBe(2);
    expect(getCharWidth("あ")).toBe(2);
    expect(getCharWidth("한")).toBe(2);
  });

  test("emoji are width 2", () => {
    expect(getCharWidth("🙂")).toBe(2);
    expect(getCharWidth("🚀")).toBe(2);
  });
});

describe("stripAnsi", () => {
  test("removes color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  test("removes 256-color codes", () => {
    expect(stripAnsi("\x1b[38;5;123mhello\x1b[39m")).toBe("hello");
  });

  test("leaves plain text alone", () => {
    expect(stripAnsi("hello")).toBe("hello");
  });
});

describe("visibleLength", () => {
  test("counts plain characters", () => {
    expect(visibleLength("hello")).toBe(5);
  });

  test("ignores ansi codes", () => {
    expect(visibleLength("\x1b[31mhello\x1b[0m")).toBe(5);
  });

  test("counts wide characters", () => {
    expect(visibleLength("中文")).toBe(4);
    expect(visibleLength("a🙂b")).toBe(4);
  });
});

describe("wrapText", () => {
  test("wraps plain text by visible width", () => {
    expect(wrapText("abcdef", 3)).toEqual(["abc", "def"]);
  });

  test("preserves explicit newlines", () => {
    expect(wrapText("ab\ncd", 3)).toEqual(["ab", "cd"]);
  });

  test("does not split ansi sequences", () => {
    const wrapped = wrapText("\x1b[31mabcdef\x1b[0m", 3);
    expect(wrapped).toEqual(["\x1b[31mabc\x1b[0m", "\x1b[31mdef\x1b[0m"]);
  });

  test("carries active color across wrapped lines", () => {
    const wrapped = wrapText("\x1b[31mred text\x1b[0m", 4);
    expect(wrapped).toEqual([
      "\x1b[31mred \x1b[0m",
      "\x1b[31mtext\x1b[0m",
    ]);
  });

  test("wraps wide characters correctly", () => {
    expect(wrapText("中文中文", 4)).toEqual(["中文", "中文"]);
  });

  test("returns empty line for empty input", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });

  test("handles reset codes between lines", () => {
    const wrapped = wrapText("\x1b[31mred\x1b[0mplain", 3);
    expect(stripAnsi(wrapped[0] ?? "")).toBe("red");
    expect(stripAnsi(wrapped[1] ?? "")).toBe("pla");
  });
});

describe("truncateText", () => {
  test("leaves short text unchanged", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  test("truncates by visible width", () => {
    expect(truncateText("hello world", 8)).toBe("hello w…");
  });

  test("ignores ansi codes when measuring", () => {
    expect(truncateText("\x1b[31mhello world\x1b[0m", 8)).toBe(
      "\x1b[31mhello w…\x1b[0m",
    );
  });

  test("accounts for wide characters", () => {
    expect(truncateText("中文中文", 5)).toBe("中文…");
  });
});

describe("tokenizeText", () => {
  test("separates ansi sequences from characters", () => {
    const tokens = [...tokenizeText("\x1b[31mab")];
    expect(tokens).toEqual([
      { type: "ansi", value: "\x1b[31m" },
      { type: "char", value: "a", width: 1 },
      { type: "char", value: "b", width: 1 },
    ]);
  });
});
