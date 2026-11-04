import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listAcpAgentPresets,
  resolveAcpAgentLaunch,
} from "./acp-agent-presets";

const OPENCODE = { args: ["acp"], command: "opencode" };

/** A folder with one executable in it, like a bin folder on PATH. */
function binFolder(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "acp-bin-"));
  const file = join(dir, name);

  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, 0o755);

  return dir;
}

/** An env with no install folders of the test machine in it. */
function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { HOME: mkdtempSync(join(tmpdir(), "acp-home-")), PATH: "", ...extra };
}

describe("ACP agent presets", () => {
  test("offers Claude and Codex, each with an entry file on this server", () => {
    const presets = listAcpAgentPresets();
    const bundled = presets.slice(0, 2);

    expect(bundled.map((preset) => preset.id)).toEqual(["claude", "codex"]);

    for (const preset of bundled) {
      expect(preset.agent.command).toBe(process.execPath);
      expect(existsSync(preset.agent.args[0] ?? "")).toBe(true);
    }
  });

  test("always offers OpenCode in ACP mode, installed or not", () => {
    const opencode = listAcpAgentPresets().find(
      (preset) => preset.id === "opencode"
    );

    expect(opencode?.agent).toEqual(OPENCODE);
  });
});

describe("ACP agent launch", () => {
  test("runs an agent with a full path as saved", () => {
    const agent = { args: ["/app/entry.js"], command: "/usr/bin/bun" };

    expect(resolveAcpAgentLaunch(agent, { env: cleanEnv() })).toEqual({
      ...agent,
      shell: false,
    });
  });

  test("OPENCODE_PATH wins over every other location", () => {
    const launch = resolveAcpAgentLaunch(OPENCODE, {
      env: cleanEnv({
        BUN_INSTALL_BIN: binFolder("opencode"),
        OPENCODE_PATH: "/custom/opencode",
      }),
    });

    expect(launch).toEqual({
      args: ["acp"],
      command: "/custom/opencode",
      shell: false,
    });
  });

  test.skipIf(process.platform === "win32")(
    "finds OpenCode in BUN_INSTALL_BIN when PATH misses it",
    () => {
      const bin = binFolder("opencode");

      const launch = resolveAcpAgentLaunch(OPENCODE, {
        env: cleanEnv({ BUN_INSTALL_BIN: bin }),
        platform: "linux",
      });

      expect(launch).toEqual({
        args: ["acp"],
        command: join(bin, "opencode"),
        shell: false,
      });
    }
  );

  test.skipIf(process.platform === "win32")(
    "finds any bare-command agent in the extra install folders",
    () => {
      const bin = binFolder("gemini");
      const agent = { args: ["--experimental-acp"], command: "gemini" };

      const launch = resolveAcpAgentLaunch(agent, {
        env: cleanEnv({ BUN_INSTALL_BIN: bin }),
        platform: "linux",
      });

      expect(launch.command).toBe(join(bin, "gemini"));
      expect(launch.args).toEqual(["--experimental-acp"]);
    }
  );

  test.skipIf(process.platform === "win32")(
    "on Linux, reads PATH by exact name only",
    () => {
      const bin = binFolder("nakama-test-agent");

      const launch = resolveAcpAgentLaunch(
        { args: [], command: "nakama-test-agent" },
        { env: cleanEnv({ Path: bin }), platform: "linux" }
      );

      expect(launch.command).toBe("nakama-test-agent");
    }
  );

  test("on Windows, runs a .cmd shim through the shell with a quoted path", () => {
    const shim = "C:\\Users\\Jo Doe\\AppData\\Roaming\\npm\\opencode.cmd";

    const launch = resolveAcpAgentLaunch(OPENCODE, {
      env: { OPENCODE_PATH: shim },
      platform: "win32",
    });

    expect(launch).toEqual({
      args: [],
      command: `"${shim}" acp`,
      shell: true,
    });
  });

  test("on Windows, runs an .exe directly", () => {
    const exe = "C:\\tools\\opencode.exe";

    const launch = resolveAcpAgentLaunch(OPENCODE, {
      env: { OPENCODE_PATH: exe },
      platform: "win32",
    });

    expect(launch).toEqual({ args: ["acp"], command: exe, shell: false });
  });

  test.skipIf(process.platform === "win32")(
    "fails to start when OpenCode is nowhere on the server",
    () => {
      expect(() =>
        resolveAcpAgentLaunch(OPENCODE, { env: cleanEnv(), platform: "linux" })
      ).toThrow();
    }
  );
});
