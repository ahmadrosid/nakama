import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AcpAgentHost,
  listAcpAgentPresets,
  resolveAcpAgentLaunch,
} from "./acp-agent-presets";

const OPENCODE = { args: ["acp"], command: "opencode" };

/** A platform package folder on disk; returns the path of its package.json. */
function opencodePackage(binary: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-pkg-"));

  if (binary) {
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", binary), "");
  }

  return join(dir, "package.json");
}

function host(overrides: Partial<AcpAgentHost> = {}): AcpAgentHost {
  return {
    arch: "x64",
    env: { PATH: "/usr/bin" },
    homeDir: "/home/user",
    platform: "linux",
    resolvePackage: () => null,
    which: () => null,
    ...overrides,
  };
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
  test("runs a bundled agent as saved", () => {
    const agent = { args: ["/app/entry.js"], command: "/usr/bin/bun" };

    expect(resolveAcpAgentLaunch(agent, host())).toEqual({
      ...agent,
      shell: false,
    });
  });

  test("OPENCODE_PATH wins over every other location", () => {
    const launch = resolveAcpAgentLaunch(
      OPENCODE,
      host({
        env: { OPENCODE_PATH: "/custom/opencode", PATH: "/usr/bin" },
        resolvePackage: () => "/nm/opencode-linux-x64/package.json",
        which: () => "/usr/bin/opencode",
      })
    );

    expect(launch).toEqual({
      args: ["acp"],
      command: "/custom/opencode",
      shell: false,
    });
  });

  test("uses the platform package binary before PATH", () => {
    const resolved: string[] = [];
    const manifest = opencodePackage("opencode");

    const launch = resolveAcpAgentLaunch(
      OPENCODE,
      host({
        arch: "arm64",
        platform: "darwin",
        resolvePackage: (name) => {
          resolved.push(name);

          return name === "opencode-darwin-arm64" ? manifest : null;
        },
        which: () => "/usr/bin/opencode",
      })
    );

    expect(resolved[0]).toBe("opencode-darwin-arm64");
    expect(launch.command).toBe(join(manifest, "..", "bin", "opencode"));
  });

  test("skips a half-installed platform package and falls back to PATH", () => {
    const launch = resolveAcpAgentLaunch(
      OPENCODE,
      host({
        resolvePackage: () => opencodePackage(null),
        which: () => "/usr/bin/opencode",
      })
    );

    expect(launch.command).toBe("/usr/bin/opencode");
  });

  test("on Linux, reads PATH by exact name only", () => {
    let searched = "";
    resolveAcpAgentLaunch(
      OPENCODE,
      host({
        env: { Path: "/wrong" },
        which: (_command, options) => {
          searched = options.PATH;

          return "/usr/bin/opencode";
        },
      })
    );

    expect(searched.split(":")).not.toContain("/wrong");
  });

  test("searches PATH plus BUN_INSTALL_BIN and the usual install folders", () => {
    let searched = "";

    const launch = resolveAcpAgentLaunch(
      OPENCODE,
      host({
        env: { BUN_INSTALL_BIN: "/nakama/data/.bun/bin", PATH: "/usr/bin" },
        which: (_command, options) => {
          searched = options.PATH;

          return "/nakama/data/.bun/bin/opencode";
        },
      })
    );

    expect(searched.split(":")).toEqual(
      expect.arrayContaining([
        "/usr/bin",
        "/nakama/data/.bun/bin",
        join("/home/user", ".opencode", "bin"),
        "/opt/homebrew/bin",
      ])
    );
    expect(launch.command).toBe("/nakama/data/.bun/bin/opencode");
  });

  test("on Windows, finds the windows package binary as an .exe and runs it directly", () => {
    const manifest = opencodePackage("opencode.exe");

    const launch = resolveAcpAgentLaunch(
      OPENCODE,
      host({
        platform: "win32",
        resolvePackage: (name) =>
          name === "opencode-windows-x64" ? manifest : null,
      })
    );

    expect(launch.shell).toBe(false);
    expect(launch.command.endsWith("opencode.exe")).toBe(true);
    expect(launch.args).toEqual(["acp"]);
  });

  test("on Windows, runs an npm .cmd shim through the shell with a quoted path", () => {
    const shim = "C:\\Users\\Jo Doe\\AppData\\Roaming\\npm\\opencode.cmd";

    const launch = resolveAcpAgentLaunch(
      OPENCODE,
      host({
        env: { Path: "C:\\Windows" },
        platform: "win32",
        which: () => shim,
      })
    );

    expect(launch).toEqual({
      args: [],
      command: `"${shim}" acp`,
      shell: true,
    });
  });

  test("on Windows, reads Path in any case and adds the npm global folder", () => {
    let searched = "";
    resolveAcpAgentLaunch(
      OPENCODE,
      host({
        env: {
          APPDATA: "C:\\Users\\jo\\AppData\\Roaming",
          Path: "C:\\Windows",
        },
        platform: "win32",
        which: (_command, options) => {
          searched = options.PATH;

          return "C:\\bin\\opencode.exe";
        },
      })
    );

    const entries = searched.split(";");
    expect(entries[0]).toBe("C:\\Windows");
    expect(entries).toContain(join("C:\\Users\\jo\\AppData\\Roaming", "npm"));
  });

  test("fails to start when OpenCode is nowhere on the server", () => {
    expect(() => resolveAcpAgentLaunch(OPENCODE, host())).toThrow();
  });
});
