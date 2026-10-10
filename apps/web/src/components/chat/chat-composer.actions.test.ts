import { describe, expect, test } from "bun:test";
import { composerActions } from "./chat-composer";

describe("composerActions", () => {
  test("keeps Stop reachable once the user starts typing the next message", () => {
    // The regression: Stop used to disappear here, so the click landed on Queue,
    // the turn was never cancelled, and every following send got a 409.
    expect(composerActions({ canStop: true, hasContent: true })).toEqual({
      showStop: true,
      showSubmit: true,
    });
  });

  test("shows Stop alone while a turn runs and the box is empty", () => {
    expect(composerActions({ canStop: true, hasContent: false })).toEqual({
      showStop: true,
      showSubmit: false,
    });
  });

  test("shows only submit when no turn is running", () => {
    expect(composerActions({ canStop: false, hasContent: true })).toEqual({
      showStop: false,
      showSubmit: true,
    });
  });
});
