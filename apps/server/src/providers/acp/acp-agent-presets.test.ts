import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { listAcpAgentPresets } from "./acp-agent-presets";

const noHostCommands = () => null;

describe("bundled ACP agents", () => {
  test("offers Claude and Codex, each with an entry file on this server", () => {
    const presets = listAcpAgentPresets(noHostCommands);

    expect(presets.map((preset) => preset.id)).toEqual(["claude", "codex"]);

    for (const preset of presets) {
      expect(preset.agent.command).toBe(process.execPath);
      expect(existsSync(preset.agent.args[0] ?? "")).toBe(true);
    }
  });
});

describe("host ACP agents", () => {
  test("offers OpenCode in ACP mode when its CLI is on the PATH", () => {
    const presets = listAcpAgentPresets((command) =>
      command === "opencode" ? "/usr/local/bin/opencode" : null
    );

    expect(presets.find((preset) => preset.id === "opencode")?.agent).toEqual({
      args: ["acp"],
      command: "opencode",
    });
  });

  test("leaves OpenCode out when its CLI is not installed", () => {
    const presets = listAcpAgentPresets(noHostCommands);

    expect(presets.some((preset) => preset.id === "opencode")).toBe(false);
  });
});
