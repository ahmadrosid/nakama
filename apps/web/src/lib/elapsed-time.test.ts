import { describe, expect, test } from "bun:test";
import { elapsedSecondsSince, formatElapsedSeconds } from "./elapsed-time";

describe("formatElapsedSeconds", () => {
  test("formats seconds under one minute", () => {
    expect(formatElapsedSeconds(12)).toBe("12s");
  });

  test("formats minutes with remainder seconds", () => {
    expect(formatElapsedSeconds(125)).toBe("2m 5s");
  });

  test("formats exact minutes without zero seconds", () => {
    expect(formatElapsedSeconds(120)).toBe("2m");
  });

  test("formats hours with remainder minutes", () => {
    expect(formatElapsedSeconds(3665)).toBe("1h 1m");
  });

  test("formats zero seconds", () => {
    expect(formatElapsedSeconds(0)).toBe("0s");
  });
});

describe("elapsedSecondsSince", () => {
  test("returns floored non-negative seconds between anchors", () => {
    expect(elapsedSecondsSince(1000, 5500)).toBe(4);
    expect(elapsedSecondsSince(5000, 1000)).toBe(0);
  });
});
