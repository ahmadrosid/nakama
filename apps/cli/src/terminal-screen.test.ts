import { describe, expect, test } from "bun:test";
import {
  consumeTerminalInput,
  isIncompleteEscapeSequence,
  isMouseEventReport,
  isTerminalResponse,
  stripCursorPositionReports,
} from "./terminal-input";

describe("isTerminalResponse", () => {
  test("detects cursor position reports", () => {
    expect(isTerminalResponse("\x1b[12;1R")).toBe(true);
    expect(isTerminalResponse("\x1b[A")).toBe(false);
  });

  test("detects mouse tracking reports", () => {
    expect(isMouseEventReport("\x1b[<64;12;8M")).toBe(true);
  });
});

describe("stripCursorPositionReports", () => {
  test("strips multiple reports in one pass and keeps the first row", () => {
    const result = stripCursorPositionReports("a\x1b[12;1R\x1b[99;2Rb");

    expect(result.row).toBe(12);
    expect(result.pending).toBe("ab");
  });

  test("returns null row when no report is present", () => {
    expect(stripCursorPositionReports("hello")).toEqual({
      pending: "hello",
      row: null,
    });
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

  test("emits mouse tracking events", () => {
    const consumed = consumeTerminalInput("a\x1b[<64;12;8Mb");

    expect(consumed.events).toEqual(["a", "\x1b[<64;12;8M", "b"]);
    expect(consumed.pending).toBe("");
  });

  test("holds incomplete ESC sequences in pending", () => {
    expect(consumeTerminalInput("\x1b").pending).toBe("\x1b");
    expect(consumeTerminalInput("\x1b[").pending).toBe("\x1b[");
    expect(consumeTerminalInput("\x1b[12").pending).toBe("\x1b[12");
  });

  test("recovers from malformed ESC instead of leaking pending", () => {
    const consumed = consumeTerminalInput("\x1bxmore");

    expect(consumed.events).toEqual(["\x1b", "x", "m", "o", "r", "e"]);
    expect(consumed.pending).toBe("");
  });
});

describe("isIncompleteEscapeSequence", () => {
  test("treats CSI and OSC prefixes as incomplete", () => {
    expect(isIncompleteEscapeSequence("\x1b")).toBe(true);
    expect(isIncompleteEscapeSequence("\x1b[")).toBe(true);
    expect(isIncompleteEscapeSequence("\x1b[1;2")).toBe(true);
    expect(isIncompleteEscapeSequence("\x1b]0;title")).toBe(true);
    expect(isIncompleteEscapeSequence("\x1bx")).toBe(false);
  });
});
