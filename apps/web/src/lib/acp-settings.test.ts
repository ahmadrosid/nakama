import { describe, expect, test } from "bun:test";
import { presetIdForAgent } from "./acp-settings";

const presets = [
  {
    agent: { args: ["/app/claude.js"], command: "bun" },
    id: "claude",
    label: "Claude",
  },
  {
    agent: { args: ["/app/codex.js"], command: "bun" },
    id: "codex",
    label: "Codex",
  },
];

describe("presetIdForAgent", () => {
  test("finds the preset whose command and args match", () => {
    expect(
      presetIdForAgent({ args: ["/app/codex.js"], command: "bun" }, presets)
    ).toBe("codex");
  });

  test("returns null for the built-in chat and for a custom command", () => {
    expect(presetIdForAgent(null, presets)).toBeNull();
    expect(
      presetIdForAgent({ args: ["--other"], command: "my-agent" }, presets)
    ).toBeNull();
  });
});
