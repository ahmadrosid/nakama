import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type AgentBrowserStatusResponse, NakamaApiError } from "@nakama/core";
import {
  ensureBunGlobalInstallDirs,
  ensureProcessPath,
  getToolExecutionEnv,
} from "../lib/ensure-process-path";
import { resolveBashBackend } from "../tools/bash-config";
import {
  buildPinnedPackageInstallPlan,
  detectNpmOrBun,
  downloadPinnedPackageTarball,
  type PinnedNpmPackage,
  probeCliVersion,
  runTimedInstallCommand,
  summarizeInstallOutput,
} from "./cli-package-install";

const AGENT_BROWSER_PACKAGE = "agent-browser";
const AGENT_BROWSER_COMMAND = "agent-browser";
const execFileAsync = promisify(execFile);

function browserOsNeoConfigPath(): string {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library/Application Support/BrowserClaw/.browseros/config.json"
    );
  }
  if (process.platform === "win32") {
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      "BrowserClaw/User Data/.browseros/config.json"
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "browserclaw/.browseros/config.json"
  );
}

export async function getBrowserOsNeoCdpPort(
  configPath = browserOsNeoConfigPath()
): Promise<number> {
  if (resolveBashBackend() !== "host") {
    throw new NakamaApiError("BrowserOS Neo needs host bash.", 400);
  }
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const port = config?.ports?.cdp;
    if (Number.isInteger(port) && port >= 1 && port <= 65_535) {
      return port;
    }
  } catch {
    // Missing or invalid local config has the same manual fallback.
  }
  throw new NakamaApiError(
    "Cannot find BrowserOS Neo's CDP port on this host. Use Local CDP.",
    404
  );
}

export function supportsAgentBrowserCdp(version: string | null): boolean {
  const match = version?.match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
  if (!match) {
    return false;
  }
  const [, major, minor] = match;
  return Number(major) > 0 || Number(minor) >= 34;
}

export async function testAgentBrowserCdp(
  port: number
): Promise<{ ok: boolean; message: string }> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new NakamaApiError("Local CDP needs a port from 1 to 65535.", 400);
  }
  if (resolveBashBackend() !== "host") {
    throw new NakamaApiError("Local CDP needs host bash.", 400);
  }
  const status = await getAgentBrowserStatus();
  if (!supportsAgentBrowserCdp(status.version)) {
    return {
      message: "Local CDP needs agent-browser 0.34.0 or newer.",
      ok: false,
    };
  }
  try {
    await execFileAsync(
      AGENT_BROWSER_COMMAND,
      ["--cdp", String(port), "tab", "list"],
      {
        env: getToolExecutionEnv(),
        maxBuffer: 64 * 1024,
        timeout: 5000,
        windowsHide: true,
      }
    );
    return { message: "Browser connection works.", ok: true };
  } catch {
    return {
      message: `Cannot reach the browser on CDP port ${port}.`,
      ok: false,
    };
  }
}

/**
 * The reviewed release. Bumping the pin is a code change, and the hash is what
 * makes the bump checkable: a tampered tarball fails the install instead of
 * running lifecycle scripts as the server.
 */
const AGENT_BROWSER_PINNED_PACKAGE: PinnedNpmPackage = {
  integrity:
    "sha512-k58FCz0yUOCANoNkMiqJe+H2y6r6sUZazqXsWF+MYq1iRC42PjtLcBoag6SSTOD/FRQppvPDvE5HDYEhclvnhw==",
  name: AGENT_BROWSER_PACKAGE,
  version: "0.38.1",
};

export function getAgentBrowserInstallCommand(): string {
  const spec = `${AGENT_BROWSER_PACKAGE}@${AGENT_BROWSER_PINNED_PACKAGE.version}`;
  const manager = detectNpmOrBun();
  const install =
    manager === "bun"
      ? `bun install -g --trust ${spec}`
      : `npm install -g ${spec}`;

  return `${install} && ${AGENT_BROWSER_COMMAND} install`;
}

async function getAgentBrowserRuntimeStatus(): Promise<
  Pick<AgentBrowserStatusResponse, "installed" | "version">
> {
  const initial = await probeCliVersion(AGENT_BROWSER_COMMAND);

  if (initial.installed || !initial.missing) {
    return {
      installed: initial.installed,
      version: initial.version,
    };
  }

  ensureProcessPath();
  const retried = await probeCliVersion(AGENT_BROWSER_COMMAND);

  return {
    installed: retried.installed,
    version: retried.version,
  };
}

function toAgentBrowserStatusResponse(
  runtime: Pick<AgentBrowserStatusResponse, "installed" | "version">
): AgentBrowserStatusResponse {
  const ready = runtime.installed && runtime.version !== null;

  return {
    installCommand: getAgentBrowserInstallCommand(),
    installed: runtime.installed,
    nextStep: ready ? null : "install",
    ready,
    statusMessage: ready
      ? null
      : "agent-browser is not installed. Install it to enable browser automation.",
    version: runtime.version,
  };
}

export async function getAgentBrowserStatus(): Promise<AgentBrowserStatusResponse> {
  const runtime = await getAgentBrowserRuntimeStatus();
  return toAgentBrowserStatusResponse(runtime);
}

export interface AgentBrowserInstallProgress {
  message: string;
}

export async function installAgentBrowser(
  onProgress?: (progress: AgentBrowserInstallProgress) => void,
  options: { registry?: string; signal?: AbortSignal; cliOnly?: boolean } = {}
): Promise<AgentBrowserStatusResponse> {
  const emitProgress = (message: string) => {
    onProgress?.({ message });
  };

  emitProgress("Starting agent-browser install.");

  try {
    // Nothing is installed until the tarball matches the pinned hash, so a
    // compromised registry or mirror fails here rather than in a
    // lifecycle script running as the server.
    const tarball = await downloadPinnedPackageTarball(
      AGENT_BROWSER_PINNED_PACKAGE,
      {
        onProgress: emitProgress,
        registry: options.registry,
        signal: options.signal,
      }
    );

    try {
      const cliPlan = buildPinnedPackageInstallPlan(tarball.path);
      if (cliPlan.command === "bun") {
        ensureBunGlobalInstallDirs();
      }

      emitProgress(cliPlan.displayCommand);

      const cliResult = await runTimedInstallCommand(cliPlan, emitProgress, {
        signal: options.signal,
      });
      const cliOutput = [cliResult.stdout, cliResult.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();

      if (cliResult.timedOut) {
        throw new NakamaApiError(
          "Install timed out while installing the agent-browser CLI.",
          502
        );
      }

      if (cliResult.exitCode !== 0) {
        throw new NakamaApiError(
          cliOutput
            ? `agent-browser CLI install failed: ${summarizeInstallOutput(cliOutput)}`
            : "agent-browser CLI install failed.",
          502
        );
      }
    } finally {
      await tarball.cleanup();
    }
  } catch (error) {
    if (error instanceof NakamaApiError) {
      throw error;
    }

    throw new NakamaApiError(
      `agent-browser CLI install refused: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502
    );
  }

  // The browser download is the long half, so starting it after the caller has
  // gone is the case this guards. The abort is checked between the two commands
  // as well as inside each one.
  if (options.signal?.aborted) {
    throw new NakamaApiError(
      "Install cancelled before the agent-browser download started.",
      502
    );
  }

  ensureProcessPath();
  if (options.cliOnly) {
    emitProgress("agent-browser CLI install finished.");
    return getAgentBrowserStatus();
  }
  emitProgress(`${AGENT_BROWSER_COMMAND} install`);

  const browserResult = await runTimedInstallCommand(
    {
      args: ["install"],
      command: AGENT_BROWSER_COMMAND,
      displayCommand: `${AGENT_BROWSER_COMMAND} install`,
    },
    emitProgress,
    { signal: options.signal }
  );
  const browserOutput = [browserResult.stdout, browserResult.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();

  if (browserResult.timedOut) {
    throw new NakamaApiError(
      "Install timed out while downloading Chrome for agent-browser.",
      502
    );
  }

  if (browserResult.exitCode !== 0) {
    throw new NakamaApiError(
      browserOutput
        ? `agent-browser browser install failed: ${summarizeInstallOutput(browserOutput)}`
        : "agent-browser browser install failed.",
      502
    );
  }

  emitProgress("agent-browser install finished. Refreshing readiness.");

  return getAgentBrowserStatus();
}
