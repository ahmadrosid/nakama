import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CLAUDE_NOT_INSTALLED_MESSAGE,
  CODEX_NOT_INSTALLED_MESSAGE,
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

/**
 * A node_modules tree laid out like the Docker image's: codex-acp, the Codex
 * wrapper, and (unless stripped) the linux-x64 binary package.
 */
function codexInstall({ binary }: { binary: boolean }) {
  const modules = join(
    mkdtempSync(join(tmpdir(), "acp-codex-")),
    "node_modules"
  );

  const entry = join(
    modules,
    "@agentclientprotocol",
    "codex-acp",
    "dist",
    "index.js"
  );

  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, "");
  mkdirSync(join(modules, "@openai", "codex"), { recursive: true });
  writeFileSync(join(modules, "@openai", "codex", "package.json"), "{}");

  if (binary) {
    const pkg = join(modules, "@openai", "codex-linux-x64");
    const bin = join(pkg, "vendor", "x86_64-unknown-linux-musl", "bin");

    mkdirSync(bin, { recursive: true });
    writeFileSync(join(pkg, "package.json"), "{}");
    writeFileSync(join(bin, "codex"), "");
  }

  return { args: [entry], command: "/usr/bin/bun" };
}

/**
 * A node_modules tree with claude-agent-acp, the Claude Agent SDK, and the
 * linux-x64 platform package. The package stays when the binary is stripped,
 * as in the desktop runtime.
 */
function claudeInstall({ binary }: { binary: boolean }) {
  const modules = join(
    mkdtempSync(join(tmpdir(), "acp-claude-")),
    "node_modules"
  );

  const entry = join(
    modules,
    "@agentclientprotocol",
    "claude-agent-acp",
    "dist",
    "index.js"
  );

  const sdk = join(modules, "@anthropic-ai", "claude-agent-sdk");
  const pkg = join(modules, "@anthropic-ai", "claude-agent-sdk-linux-x64");

  for (const dir of [dirname(entry), sdk, pkg]) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(entry, "");
  writeFileSync(join(sdk, "package.json"), '{"main":"sdk.mjs"}');
  writeFileSync(join(sdk, "sdk.mjs"), "");
  writeFileSync(join(pkg, "package.json"), "{}");

  if (binary) {
    writeFileSync(join(pkg, "claude"), "");
  }

  return { args: [entry], command: "/usr/bin/bun" };
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

  test("starts the bundled Codex preset on this machine", () => {
    const codex = listAcpAgentPresets().find((preset) => preset.id === "codex");

    expect(() =>
      resolveAcpAgentLaunch(codex!.agent, { env: cleanEnv() })
    ).not.toThrow();
  });

  test("says Codex can't run when its binary was stripped", () => {
    const agent = codexInstall({ binary: false });

    // Not the desktop app: a CLI on PATH is not used.
    expect(() =>
      resolveAcpAgentLaunch(agent, {
        arch: "x64",
        env: cleanEnv({ PATH: binFolder("codex") }),
        platform: "linux",
      })
    ).toThrow(CODEX_NOT_INSTALLED_MESSAGE);
  });

  test("starts Codex when its platform binary is there", () => {
    const agent = codexInstall({ binary: true });

    expect(
      resolveAcpAgentLaunch(agent, {
        arch: "x64",
        env: cleanEnv(),
        platform: "linux",
      })
    ).toEqual({ ...agent, shell: false });
  });

  test("CODEX_PATH skips the bundled binary check", () => {
    const agent = codexInstall({ binary: false });

    expect(() =>
      resolveAcpAgentLaunch(agent, {
        arch: "x64",
        env: cleanEnv({ CODEX_PATH: "/usr/local/bin/codex" }),
        platform: "linux",
      })
    ).not.toThrow();
  });

  test.skipIf(process.platform === "win32")(
    "uses the installed Codex CLI when the bundled binary was stripped",
    () => {
      const agent = codexInstall({ binary: false });
      const bin = binFolder("codex");

      const launch = resolveAcpAgentLaunch(agent, {
        arch: "x64",
        env: cleanEnv({ NAKAMA_DESKTOP: "1", PATH: bin }),
        platform: "linux",
      });

      expect(launch.command).toBe(agent.command);
      expect(launch.env?.CODEX_PATH).toBe(join(bin, "codex"));
      // The CLI can be a Node script, so it gets the folders it was found in.
      expect(launch.env?.PATH?.split(":")).toContain(bin);
    }
  );

  test("says Claude can't run when its binary was stripped", () => {
    const agent = claudeInstall({ binary: false });

    // Not the desktop app: a CLI on PATH is not used.
    expect(() =>
      resolveAcpAgentLaunch(agent, {
        arch: "x64",
        env: cleanEnv({ PATH: binFolder("claude") }),
        platform: "linux",
      })
    ).toThrow(CLAUDE_NOT_INSTALLED_MESSAGE);
  });

  test("starts Claude with its bundled binary and no override", () => {
    const agent = claudeInstall({ binary: true });

    const launch = resolveAcpAgentLaunch(agent, {
      arch: "x64",
      env: cleanEnv({ PATH: binFolder("claude") }),
      platform: "linux",
    });

    expect(launch.env).toBeUndefined();
    expect(launch.command).toBe(agent.command);
  });

  test.skipIf(process.platform === "win32")(
    "uses Claude Code from ~/.local/bin when the bundled binary was stripped",
    () => {
      const agent = claudeInstall({ binary: false });
      const env = cleanEnv({ NAKAMA_DESKTOP: "1" });
      const bin = join(env.HOME ?? "", ".local", "bin");

      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
      chmodSync(join(bin, "claude"), 0o755);

      const launch = resolveAcpAgentLaunch(agent, {
        arch: "x64",
        env,
        platform: "linux",
      });

      expect(launch.env?.CLAUDE_CODE_EXECUTABLE).toBe(join(bin, "claude"));
    }
  );

  test("CLAUDE_CODE_EXECUTABLE skips the bundled binary check", () => {
    const agent = claudeInstall({ binary: false });

    const launch = resolveAcpAgentLaunch(agent, {
      arch: "x64",
      env: cleanEnv({ CLAUDE_CODE_EXECUTABLE: "/usr/local/bin/claude" }),
      platform: "linux",
    });

    expect(launch.env).toBeUndefined();
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
