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

    expect(() =>
      resolveAcpAgentLaunch(agent, {
        arch: "x64",
        env: cleanEnv(),
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
    "fails to start when OpenCode is nowhere on the server",
    () => {
      expect(() =>
        resolveAcpAgentLaunch(OPENCODE, { env: cleanEnv(), platform: "linux" })
      ).toThrow();
    }
  );
});
