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
});
