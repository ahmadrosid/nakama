import { describe, expect, test } from "bun:test";
import { consumeTerminalInput, isTerminalResponse } from "./terminal-input";
import { appendStreamText, ScreenBuffer } from "./screen-buffer";

describe("isTerminalResponse", () => {
  test("detects cursor position reports", () => {
    expect(isTerminalResponse("\x1b[12;1R")).toBe(true);
    expect(isTerminalResponse("\x1b[A")).toBe(false);
  });

  test("detects mouse tracking reports", () => {
    expect(isTerminalResponse("\x1b[<64;12;8M")).toBe(true);
  });
});

describe("consumeTerminalInput", () => {
  test("swallows cursor reports and emits key input", () => {
    const consumed = consumeTerminalInput("a\x1b[12;1Rb");

    expect(consumed.events).toEqual(["a", "b"]);
    expect(consumed.pending).toBe("");
  });

  test("keeps bracketed paste intact", () => {
    const consumed = consumeTerminalInput("\x1b[200~hello\x1b[201~");

    expect(consumed.events).toEqual(["\x1b[200~hello\x1b[201~"]);
  });

  test("isTerminalResponse identifies cursor reports", () => {
    expect(isTerminalResponse("\x1b[12;1R")).toBe(true);
  });

  test("swallows mouse tracking events", () => {
    const consumed = consumeTerminalInput("a\x1b[<64;12;8Mb");

    expect(consumed.events).toEqual(["a", "b"]);
    expect(consumed.pending).toBe("");
  });
});

describe("ScreenBuffer", () => {
  test("tracks content, status, and input rows", () => {
    const buffer = new ScreenBuffer();

    buffer.appendLine("hello");
    buffer.setStatus("thinking");
    buffer.setInputLines(["> ", "  line"]);

    expect(buffer.contentRowCount()).toBe(2);
    expect(buffer.inputRowCount()).toBe(2);
    expect(buffer.totalRowCount()).toBe(4);
  });

  test("splits streamed text into wrapped lines", () => {
    const buffer = new ScreenBuffer();
    buffer.appendStream("abcdefghij", 4);

    expect(buffer.getVisibleContentLines()).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("appendStreamText", () => {
  test("wraps at terminal width", () => {
    const result = appendStreamText([], "", "abcdef", 3);

    expect(result.lines).toEqual(["abc", "def"]);
    expect(result.activeLine).toBe("");
  });

  test("preserves active ansi color across wrapped lines", () => {
    const result = appendStreamText([], "", "\x1b[31mabcdef\x1b[0m", 3);

    expect(result.lines).toEqual(["\x1b[31mabc\x1b[0m", "\x1b[31mdef\x1b[0m"]);
    expect(result.activeLine).toBe("");
  });

  test("carries color to the next chunk", () => {
    const first = appendStreamText([], "", "\x1b[31mabc", 10);
    const second = appendStreamText(first.lines, first.activeLine, "def\x1b[0m", 10);

    expect(second.activeLine).toBe("\x1b[31mabcdef\x1b[0m");
  });

  test("wraps wide characters by visible width", () => {
    const result = appendStreamText([], "", "中文中文", 4);

    expect(result.lines).toEqual(["中文", "中文"]);
    expect(result.activeLine).toBe("");
  });
});
