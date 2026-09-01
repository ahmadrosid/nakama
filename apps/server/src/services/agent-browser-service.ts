import { type AgentBrowserStatusResponse, NakamaApiError } from "@nakama/core";
import {
  ensureBunGlobalInstallDirs,
  ensureProcessPath,
} from "../lib/ensure-process-path";
import {
  buildGlobalPackageInstallPlan,
  probeCliVersion,
  runTimedInstallCommand,
  summarizeInstallOutput,
} from "./cli-package-install";

const AGENT_BROWSER_PACKAGE = "agent-browser";
const AGENT_BROWSER_COMMAND = "agent-browser";

function buildAgentBrowserCliInstallPlan() {
  return buildGlobalPackageInstallPlan(AGENT_BROWSER_PACKAGE);
}

export function getAgentBrowserInstallCommand(): string {
  const cliPlan = buildAgentBrowserCliInstallPlan();
  return `${cliPlan.displayCommand} && ${AGENT_BROWSER_COMMAND} install`;
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
  onProgress?: (progress: AgentBrowserInstallProgress) => void
): Promise<AgentBrowserStatusResponse> {
  const emitProgress = (message: string) => {
    onProgress?.({ message });
  };

  const cliPlan = buildAgentBrowserCliInstallPlan();
  if (cliPlan.command === "bun") {
    ensureBunGlobalInstallDirs();
  }

  emitProgress("Starting agent-browser install.");
  emitProgress(cliPlan.displayCommand);

  const cliResult = await runTimedInstallCommand(cliPlan, emitProgress);
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

  ensureProcessPath();
  emitProgress(`${AGENT_BROWSER_COMMAND} install`);

  const browserResult = await runTimedInstallCommand(
    {
      args: ["install"],
      command: AGENT_BROWSER_COMMAND,
      displayCommand: `${AGENT_BROWSER_COMMAND} install`,
    },
    emitProgress
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
