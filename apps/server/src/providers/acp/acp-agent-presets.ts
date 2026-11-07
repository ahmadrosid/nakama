import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AcpAgentConfig } from "@nakama/core";
import { z } from "zod";

/**
 * Agents Nakama ships with. They are pinned in the runtime manifest, so each
 * one runs from node_modules: no download when a chat starts.
 */
const BUNDLED_AGENTS = [
  {
    id: "claude",
    label: "Claude",
    packageName: "@agentclientprotocol/claude-agent-acp",
  },
  {
    id: "codex",
    label: "Codex",
    packageName: "@agentclientprotocol/codex-acp",
  },
] as const;

/**
 * OpenCode has no separate ACP adapter: its own CLI speaks ACP. The profile
 * keeps the bare command, and `resolveAcpAgentLaunch` finds the binary when
 * the agent starts.
 */
const OPENCODE_AGENT = {
  agent: { args: ["acp"], command: "opencode" },
  id: "opencode",
  label: "OpenCode",
} as const;

export interface AcpAgentPreset {
  agent: AcpAgentConfig;
  id: string;
  label: string;
}

// A package can declare its bin as one path or as a map. Both become a map here.
const packageManifestSchema = z.object({
  bin: z
    .union([
      z.string().transform((entry) => ({ default: entry })),
      z.record(z.string(), z.string()),
    ])
    .optional(),
});

/** The agents a profile can pick, with bundled entry points resolved on this server. */
export function listAcpAgentPresets(): AcpAgentPreset[] {
  const bundled = BUNDLED_AGENTS.map(({ id, label, packageName }) => ({
    agent: resolveBundledAgent(packageName),
    id,
    label,
  }));

  return [
    ...bundled,
    {
      agent: {
        args: [...OPENCODE_AGENT.agent.args],
        command: OPENCODE_AGENT.agent.command,
      },
      id: OPENCODE_AGENT.id,
      label: OPENCODE_AGENT.label,
    },
  ];
}

/**
 * Runs the agent's JavaScript entry with the server's own Bun binary. The
 * entry comes from the package's `bin` field.
 */
function resolveBundledAgent(packageName: string): AcpAgentConfig {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve(`${packageName}/package.json`);

  const manifest = packageManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );

  const entry = Object.values(manifest.bin ?? {})[0];

  if (!entry) {
    throw new Error(`${packageName} has no bin entry.`);
  }

  return {
    args: [join(dirname(manifestPath), entry)],
    command: process.execPath,
  };
}

export interface AcpAgentLaunchCommand {
  args: string[];
  command: string;
  /** Windows `.cmd` / `.bat` shims only run through a shell. */
  shell: boolean;
}

/** Only for tests: the server's own values are the default. */
export interface AcpAgentLaunchOptions {
  arch?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** Windows env names ignore case (`Path`); Linux and macOS names do not. */
function readEnv(
  host: Required<AcpAgentLaunchOptions>,
  name: string
): string | undefined {
  if (host.platform !== "win32") {
    return host.env[name];
  }

  const key = Object.keys(host.env).find(
    (entry) => entry.toUpperCase() === name.toUpperCase()
  );

  return key ? host.env[key] : undefined;
}

/**
 * The platform binary that `opencode-ai` installs as an optional dependency.
 * Its own bin is a stub until postinstall runs, and Nakama installs with
 * `--ignore-scripts`, so the platform package is the reliable path.
 */
function findOpencodePackageBinary(platform: NodeJS.Platform): string | null {
  const os = platform === "win32" ? "windows" : platform;
  const binary = platform === "win32" ? "opencode.exe" : "opencode";
  const base = `opencode-${os}-${process.arch}`;
  const require = createRequire(import.meta.url);

  // `-baseline` first: it runs on every x64 CPU. The plain x64 build needs
  // AVX2 and fails with `Illegal instruction` without it.
  for (const suffix of ["-baseline", "", "-baseline-musl", "-musl"]) {
    let manifest: string;

    try {
      manifest = require.resolve(`${base}${suffix}/package.json`);
    } catch {
      continue;
    }

    const path = join(dirname(manifest), "bin", binary);

    // A half-installed package has no binary. Fall through to PATH then.
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * The server PATH misses common install folders: the desktop app starts the
 * server with a minimal GUI PATH, and Docker keeps `bun add -g` binaries in
 * BUN_INSTALL_BIN.
 */
function agentSearchPath(host: Required<AcpAgentLaunchOptions>): string {
  const sep = host.platform === "win32" ? ";" : ":";

  const home =
    readEnv(host, host.platform === "win32" ? "USERPROFILE" : "HOME") ??
    homedir();

  const appData = readEnv(host, "APPDATA");

  const extras = [
    readEnv(host, "BUN_INSTALL_BIN"),
    join(home, ".bun", "bin"),
    join(home, ".opencode", "bin"),
    // npm's global bin on Windows, where `npm i -g` puts `.cmd` shims.
    ...(host.platform === "win32"
      ? [appData ? join(appData, "npm") : undefined]
      : ["/opt/homebrew/bin", "/usr/local/bin"]),
  ];

  return [readEnv(host, "PATH"), ...extras]
    .filter((entry): entry is string => Boolean(entry))
    .join(sep);
}

export const CODEX_NOT_INSTALLED_MESSAGE =
  "Codex can't run on this Nakama server yet: its program isn't installed here, and Nakama Cloud doesn't include it at the moment. Pick Claude or OpenCode as this profile's chat agent instead. Self-hosting? Use the -full image, or set CODEX_PATH to a codex binary.";

const CODEX_TARGETS = new Map([
  ["darwin-arm64", "aarch64-apple-darwin"],
  ["darwin-x64", "x86_64-apple-darwin"],
  ["linux-arm64", "aarch64-unknown-linux-musl"],
  ["linux-x64", "x86_64-unknown-linux-musl"],
  ["win32-arm64", "aarch64-pc-windows-msvc"],
  ["win32-x64", "x86_64-pc-windows-msvc"],
]);

/**
 * Whether the native Codex binary that codex-acp spawns is on this server.
 * The slim Docker image deletes `@openai/codex-<os>-<arch>` and keeps only
 * the JavaScript wrapper, which then exits 1 on every chat. This follows the
 * wrapper's own lookup. An unknown platform counts as installed, so Codex
 * reports its own error there.
 */
function hasCodexBinary(
  codexAcpEntry: string,
  host: Required<AcpAgentLaunchOptions>
): boolean {
  const key = `${host.platform === "android" ? "linux" : host.platform}-${host.arch}`;
  const target = CODEX_TARGETS.get(key);

  if (!target) {
    return true;
  }

  let codexRoot: string;

  try {
    codexRoot = dirname(
      createRequire(codexAcpEntry).resolve("@openai/codex/package.json")
    );
  } catch {
    return false;
  }

  let vendorRoot = join(codexRoot, "vendor");

  try {
    vendorRoot = join(
      dirname(
        createRequire(join(codexRoot, "package.json")).resolve(
          `@openai/codex-${key}/package.json`
        )
      ),
      "vendor"
    );
  } catch {
    // Older Codex builds keep the binary in their own vendor folder.
  }

  const binary = host.platform === "win32" ? "codex.exe" : "codex";

  return existsSync(join(vendorRoot, target, "bin", binary));
}

function isBareCommand(command: string): boolean {
  return !/[\\/]/.test(command);
}

/**
 * Turns a profile's saved agent into the command to spawn. Bundled agents
 * already carry absolute paths. A bare command (`opencode`, `gemini`) is found
 * here, at start time, so the preset stays the same whether or not the agent
 * is installed yet.
 */
export function resolveAcpAgentLaunch(
  agent: AcpAgentConfig,
  options: AcpAgentLaunchOptions = {}
): AcpAgentLaunchCommand {
  const host: Required<AcpAgentLaunchOptions> = {
    arch: options.arch ?? process.arch,
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
  };

  // A saved Codex agent runs the bundled codex-acp entry. CODEX_PATH replaces
  // the bundled binary, so only check without it.
  const codexAcpEntry = agent.args.find((arg) =>
    /[\\/]@agentclientprotocol[\\/]codex-acp[\\/]/.test(arg)
  );

  if (
    codexAcpEntry &&
    !readEnv(host, "CODEX_PATH") &&
    !hasCodexBinary(codexAcpEntry, host)
  ) {
    throw new Error(CODEX_NOT_INSTALLED_MESSAGE);
  }

  const isOpencode = agent.command === OPENCODE_AGENT.agent.command;

  const found =
    (isOpencode
      ? readEnv(host, "OPENCODE_PATH") ||
        findOpencodePackageBinary(host.platform)
      : null) ||
    (isBareCommand(agent.command)
      ? Bun.which(agent.command, { PATH: agentSearchPath(host) })
      : agent.command);

  if (!found) {
    if (isOpencode) {
      throw new Error(
        "OpenCode is not installed on the Nakama server. Install opencode-ai (OpenCode 0.15.10 or later), or set OPENCODE_PATH to the opencode binary."
      );
    }

    // Spawn fails with ENOENT, and the start error names the command.
    return { args: agent.args, command: agent.command, shell: false };
  }

  if (host.platform === "win32" && /\.(?:cmd|bat)$/i.test(found)) {
    // Same as codex-acp with CODEX_PATH: one quoted command line for cmd.exe.
    return {
      args: [],
      command: [`"${found}"`, ...agent.args].join(" "),
      shell: true,
    };
  }

  return { args: agent.args, command: found, shell: false };
}
