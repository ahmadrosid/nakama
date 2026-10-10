import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { listAcpAgentPresets } from "./acp-agent-presets";

describe("bundled ACP agents", () => {
  test("offers Claude and Codex, each with an entry file on this server", () => {
    const presets = listAcpAgentPresets();

    expect(presets.map((preset) => preset.id)).toEqual(["claude", "codex"]);

    for (const preset of presets) {
      expect(preset.agent.command).toBe(process.execPath);
      expect(existsSync(preset.agent.args[0] ?? "")).toBe(true);
    }
  });
});
