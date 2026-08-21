import { describe, expect, test } from "bun:test";
import { listOverflowsViewport } from "./chat-list-stickiness";

describe("listOverflowsViewport", () => {
  test("detects when content is taller than the viewport", () => {
    expect(listOverflowsViewport(800, 600)).toBe(true);
    expect(listOverflowsViewport(600, 600)).toBe(false);
    expect(listOverflowsViewport(200, 600)).toBe(false);
  });

  test("does not treat unknown viewport size as overflow", () => {
    expect(listOverflowsViewport(400, 0)).toBe(false);
  });
});
