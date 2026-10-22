import { describe, expect, test } from "bun:test";
import { elapsedSecondsSince } from "./elapsed-time";

describe("elapsedSecondsSince", () => {
  test("returns floored non-negative seconds between anchors", () => {
    expect(elapsedSecondsSince(1000, 5500)).toBe(4);
    expect(elapsedSecondsSince(5000, 1000)).toBe(0);
  });
});
