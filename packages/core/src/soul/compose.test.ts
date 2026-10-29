import { describe, expect, test } from "bun:test";
import { composeSoulSystemPrompt } from "./compose";
import { SOUL_TEMPLATE } from "./templates";

describe("composeSoulSystemPrompt", () => {
  test("includes the profile prompt when it differs from SOUL", () => {
    const prompt = composeSoulSystemPrompt(
      {
        directory: "/tmp",
        files: { soul: SOUL_TEMPLATE },
        loaded: ["SOUL.md"],
      },
      { profilePrompt: "Always respond in pirate speak." }
    );

    expect(prompt).toContain("Always respond in pirate speak.");
  });
});
