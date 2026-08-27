import { describe, expect, test } from "bun:test";
import {
  consumeTerminalInput,
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
});
