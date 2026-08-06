import type { AgentBrowserStatusResponse } from "@nakama/core";
import { ensureBunGlobalInstallDirs, ensureProcessPath, getToolExecutionEnv } from "../lib/ensure-process-path";

const AGENT_BROWSER_PACKAGE = "agent-browser";
const AGENT_BROWSER_COMMAND = "agent-browser";

interface AgentBrowserInstallPlan {
  command: string;
  args: string[];
  displayCommand: string;
}

function detectPackageManager(): "npm" | "bun" {
  if (Bun.which("npm")) {
    return "npm";
  }

  if (Bun.which("bun")) {
    return "bun";
  }

  return "npm";
}

function buildAgentBrowserCliInstallPlan(
  packageManager: "npm" | "bun" = detectPackageManager(),
): AgentBrowserInstallPlan {
  if (packageManager === "bun") {
    return {
      command: "bun",
      args: ["install", "-g", "--trust", AGENT_BROWSER_PACKAGE],
      displayCommand: `bun install -g --trust ${AGENT_BROWSER_PACKAGE}`,
    };
  }

  return {
    command: "npm",
    args: ["install", "-g", AGENT_BROWSER_PACKAGE],
    displayCommand: `npm install -g ${AGENT_BROWSER_PACKAGE}`,
  };
}

export function getAgentBrowserInstallCommand(): string {
  const cliPlan = buildAgentBrowserCliInstallPlan();
  return `${cliPlan.displayCommand} && ${AGENT_BROWSER_COMMAND} install`;
}

function extractVersion(stdout: string, stderr: string): string | null {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output) {
    return null;
  }

  return output.split(/\r?\n/, 1)[0]?.trim() || null;
}

async function probeAgentBrowserVersion(): Promise<{
  installed: boolean;
  version: string | null;
  missing: boolean;
}> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const child = spawn(AGENT_BROWSER_COMMAND, ["--version"], {
      env: getToolExecutionEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) =>
      resolve({
        installed: false,
        version: null,
        missing: (error as NodeJS.ErrnoException).code === "ENOENT",
      }),
    );
    child.once("close", (code) =>
      resolve({
        installed: code === 0,
        version: code === 0 ? extractVersion(stdout, stderr) : null,
        missing: false,
      }),
    );
  });
}

async function getAgentBrowserRuntimeStatus(): Promise<Pick<AgentBrowserStatusResponse, "installed" | "version">> {
  const initial = await probeAgentBrowserVersion();

  if (initial.installed || !initial.missing) {
    return {
      installed: initial.installed,
      version: initial.version,
    };
  }

  ensureProcessPath();
  const retried = await probeAgentBrowserVersion();

  return {
    installed: retried.installed,
    version: retried.version,
  };
}

function toAgentBrowserStatusResponse(
  runtime: Pick<AgentBrowserStatusResponse, "installed" | "version">,
): AgentBrowserStatusResponse {
  const ready = runtime.installed && runtime.version !== null;

  return {
    installed: runtime.installed,
    version: runtime.version,
    ready,
    installCommand: getAgentBrowserInstallCommand(),
    nextStep: ready ? null : "install",
    statusMessage: ready
      ? "agent-browser is installed and ready."
      : "Install the agent-browser CLI and Chrome on this machine.",
  };
}

export async function getAgentBrowserStatus(): Promise<AgentBrowserStatusResponse> {
  const runtime = await getAgentBrowserRuntimeStatus();
  return toAgentBrowserStatusResponse(runtime);
}

export interface AgentBrowserInstallProgress {
  message: string;
}

async function runInstallCommand(
  plan: AgentBrowserInstallPlan,
  onProgress?: (message: string) => void,
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const { spawn } = await import("node:child_process");
  const timeoutMs = 120_000;

  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, {
      env: getToolExecutionEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const emitLine = (prefix: "stdout" | "stderr", line: string) => {
      onProgress?.(`${prefix}: ${line}`);
    };

    const flushBuffer = (buffer: string, prefix: "stdout" | "stderr") => {
      let nextBuffer = buffer;

      while (true) {
        const newlineIndex = nextBuffer.search(/\r?\n/);

        if (newlineIndex < 0) {
          break;
        }

        const newlineLength = nextBuffer[newlineIndex] === "\r" ? 2 : 1;
        const line = nextBuffer.slice(0, newlineIndex).trim();
        nextBuffer = nextBuffer.slice(newlineIndex + newlineLength);

        if (line) {
          emitLine(prefix, line);
        }
      }

      return nextBuffer;
    };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      stdoutBuffer = flushBuffer(stdoutBuffer, "stdout");
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;
      stderrBuffer = flushBuffer(stderrBuffer, "stderr");
    });

    child.once("error", (error) => {
      clearTimeout(timeoutId);

      if (stdoutBuffer.trim()) {
        emitLine("stdout", stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        emitLine("stderr", stderrBuffer.trim());
      }

      resolve({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
        timedOut,
      });
    });

    child.once("close", (exitCode) => {
      clearTimeout(timeoutId);

      if (stdoutBuffer.trim()) {
        emitLine("stdout", stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        emitLine("stderr", stderrBuffer.trim());
      }

      resolve({
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    });
  });
}

function summarizeInstallOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningful =
    lines.find((line) => /^error:/i.test(line)) ??
    lines.find((line) => /(?:EACCES|ENOENT|EPERM|failed|permission denied)/i.test(line)) ??
    lines.find((line) => !/^bun (?:add|install) v/i.test(line)) ??
    lines[0] ??
    output.trim();
  return meaningful.length > 180 ? `${meaningful.slice(0, 177)}...` : meaningful;
}

async function runAgentBrowserCommand(
  args: string[],
  onProgress?: (message: string) => void,
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return runInstallCommand(
    {
      command: AGENT_BROWSER_COMMAND,
      args,
      displayCommand: `${AGENT_BROWSER_COMMAND} ${args.join(" ")}`,
    },
    onProgress,
  );
}

export async function installAgentBrowser(
  onProgress?: (progress: AgentBrowserInstallProgress) => void,
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

  const cliResult = await runInstallCommand(cliPlan, emitProgress);
  const cliOutput = [cliResult.stdout, cliResult.stderr].filter(Boolean).join("\n").trim();

  if (cliResult.timedOut) {
    throw new Error("Install timed out while installing the agent-browser CLI.");
  }

  if (cliResult.exitCode !== 0) {
    throw new Error(
      cliOutput
        ? `agent-browser CLI install failed: ${summarizeInstallOutput(cliOutput)}`
        : "agent-browser CLI install failed.",
    );
  }

  ensureProcessPath();
  emitProgress(`${AGENT_BROWSER_COMMAND} install`);

  const browserResult = await runAgentBrowserCommand(["install"], emitProgress);
  const browserOutput = [browserResult.stdout, browserResult.stderr].filter(Boolean).join("\n").trim();

  if (browserResult.timedOut) {
    throw new Error("Install timed out while downloading Chrome for agent-browser.");
  }

  if (browserResult.exitCode !== 0) {
    throw new Error(
      browserOutput
        ? `agent-browser browser install failed: ${summarizeInstallOutput(browserOutput)}`
        : "agent-browser browser install failed.",
    );
  }

  emitProgress("agent-browser install finished. Refreshing readiness.");

  return getAgentBrowserStatus();
}
