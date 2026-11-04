import { readFileSync } from "node:fs";
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

export interface AcpAgentHost {
  arch: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
  /** Absolute path of a package's `package.json`, or null when it is not installed. */
  resolvePackage: (packageName: string) => string | null;
  which: (command: string, options: { PATH: string }) => string | null;
}

function resolveInstalledPackage(packageName: string): string | null {
  try {
    return createRequire(import.meta.url).resolve(
      `${packageName}/package.json`
    );
  } catch {
    return null;
  }
}

const SERVER_HOST: AcpAgentHost = {
  arch: process.arch,
  env: process.env,
  homeDir: homedir(),
  platform: process.platform,
  resolvePackage: resolveInstalledPackage,
  which: (command, options) => Bun.which(command, options),
};

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(
    (entry) => entry.toUpperCase() === name.toUpperCase()
  );

  return key ? env[key] : undefined;
}

/**
 * The platform binary that `opencode-ai` installs as an optional dependency.
 * Its own bin is a stub until postinstall runs, and Nakama installs with
 * `--ignore-scripts`, so the platform package is the reliable path.
 */
function findOpencodePackageBinary(host: AcpAgentHost): string | null {
  const os = host.platform === "win32" ? "windows" : host.platform;
  const binary = host.platform === "win32" ? "opencode.exe" : "opencode";
  const base = `opencode-${os}-${host.arch}`;

  for (const suffix of ["", "-baseline", "-musl", "-baseline-musl"]) {
    const manifest = host.resolvePackage(`${base}${suffix}`);

    if (manifest) {
      return join(dirname(manifest), "bin", binary);
    }
  }

  return null;
}

/**
 * The server PATH misses common install folders: the desktop app starts the
 * server with a minimal GUI PATH, and Docker keeps `bun add -g` binaries in
 * BUN_INSTALL_BIN.
 */
function opencodeSearchPath(host: AcpAgentHost): string {
  const sep = host.platform === "win32" ? ";" : ":";
  const appData = readEnv(host.env, "APPDATA");

  const extras = [
    readEnv(host.env, "BUN_INSTALL_BIN"),
    join(host.homeDir, ".bun", "bin"),
    join(host.homeDir, ".opencode", "bin"),
    // npm's global bin on Windows, where `npm i -g` puts `opencode.cmd`.
    ...(host.platform === "win32"
      ? [appData ? join(appData, "npm") : undefined]
      : ["/opt/homebrew/bin", "/usr/local/bin"]),
  ];

  return [readEnv(host.env, "PATH"), ...extras]
    .filter((entry): entry is string => Boolean(entry))
    .join(sep);
}

function findOpencode(host: AcpAgentHost): string | null {
  return (
    readEnv(host.env, "OPENCODE_PATH") ||
    findOpencodePackageBinary(host) ||
    host.which("opencode", { PATH: opencodeSearchPath(host) })
  );
}

/**
 * Turns a profile's saved agent into the command to spawn. Bundled agents
 * already carry absolute paths. OpenCode is found here, at start time, so the
 * preset stays the same whether or not OpenCode is installed yet.
 */
export function resolveAcpAgentLaunch(
  agent: AcpAgentConfig,
  host: AcpAgentHost = SERVER_HOST
): AcpAgentLaunchCommand {
  if (agent.command !== OPENCODE_AGENT.agent.command) {
    return { args: agent.args, command: agent.command, shell: false };
  }

  const found = findOpencode(host);

  if (!found) {
    throw new Error(
      "OpenCode is not installed on the Nakama server. Install opencode-ai (OpenCode 0.15.10 or later), or set OPENCODE_PATH to the opencode binary."
    );
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
