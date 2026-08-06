import { describe, expect, test } from "bun:test";
import {
  followOutputBehavior,
  listOverflowsViewport,
  shouldAutoscrollOnHeightGrowth,
} from "./chat-list-stickiness";

describe("followOutputBehavior", () => {
  test("follows with auto when at bottom", () => {
    expect(followOutputBehavior(true)).toBe("auto");
  });

  test("does not follow when not at bottom", () => {
    expect(followOutputBehavior(false)).toBe(false);
  });
});

describe("shouldAutoscrollOnHeightGrowth", () => {
  test("autoscrolls only when at bottom", () => {
    expect(shouldAutoscrollOnHeightGrowth(true)).toBe(true);
    expect(shouldAutoscrollOnHeightGrowth(false)).toBe(false);
  });
});

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
