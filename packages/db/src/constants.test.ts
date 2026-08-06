import { describe, expect, test } from "bun:test";
import { SUPER_BOT_SYSTEM_PROMPT } from "./constants";

describe("SUPER_BOT_SYSTEM_PROMPT", () => {
  test("requires draft-and-confirm before create_profile", () => {
    expect(SUPER_BOT_SYSTEM_PROMPT).toContain("create_profile");
    expect(SUPER_BOT_SYSTEM_PROMPT.toLowerCase()).toMatch(/draft/);
    expect(SUPER_BOT_SYSTEM_PROMPT.toLowerCase()).toMatch(/confirm/);
    expect(SUPER_BOT_SYSTEM_PROMPT).not.toContain(
      "without confirming intent when the user did not ask for it",
    );
  });
});
