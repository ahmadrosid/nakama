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
  test("keeps Kitty key events intact across chunk boundaries", () => {
    const sequence = "\x1b[104:72;2:1u";

    for (let split = 1; split < sequence.length; split++) {
      const first = consumeTerminalInput(sequence.slice(0, split));
      expect(first.events).toEqual([]);
      expect(
        consumeTerminalInput(first.pending + sequence.slice(split))
      ).toEqual({
        events: [sequence],
        pending: "",
      });
    }
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
