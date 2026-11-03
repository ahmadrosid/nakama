import { describe, expect, test } from "bun:test";
import type { Mood } from "./core";
import {
  type AgentActivity,
  MOODSTONE_COLORS,
  MOODSTONE_CUTS,
  moodForActivity,
  moodstoneIndexes,
  moodstoneSvg,
} from "./index";

describe("moodstoneIndexes", () => {
  test("keeps the shipped identity hash stable", () => {
    // Existing profiles must keep the same face and color across releases.
    expect(moodstoneIndexes("profile-123")).toEqual({
      avatarIndex: 6,
      colorIndex: 0,
    });
    expect(moodstoneIndexes("agent-alpha")).toEqual({
      avatarIndex: 3,
      colorIndex: 1,
    });
  });

  test("always returns a valid cut and color", () => {
    for (const identity of ["", "a", "Vincent", "?".repeat(80)]) {
      const { avatarIndex, colorIndex } = moodstoneIndexes(identity);

      expect(avatarIndex).toBeGreaterThanOrEqual(0);
      expect(avatarIndex).toBeLessThan(MOODSTONE_CUTS.length);
      expect(colorIndex).toBeGreaterThanOrEqual(0);
      expect(colorIndex).toBeLessThan(MOODSTONE_COLORS.length);
    }
  });
});

describe("moodstoneSvg", () => {
  test("an animated face loops and carries the upstream MIT notice", () => {
    const svg = moodstoneSvg(0, 0, true, "thinking");

    expect(svg).toContain("<animate");
    expect(svg).toContain("MIT License");
    expect(svg).not.toContain("MOODSTONE_");
  });

  test("a still face is one frame", () => {
    const svg = moodstoneSvg(0, 0, false, "idle");

    expect(svg).not.toContain("<animate");
  });
});

describe("moodForActivity", () => {
  test("maps every lifecycle state to its mood", () => {
    const cases: Array<[AgentActivity, Mood]> = [
      ["done", "done"],
      ["error", "failed"],
      ["idle", "idle"],
      ["responding", "working"],
      ["thinking", "thinking"],
      ["tool", "observing"],
    ];

    for (const [activity, mood] of cases) {
      expect(moodForActivity(activity)).toBe(mood);
    }
  });
});
