import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  DatabaseAdapter,
  StoredCodingAgentHarnessKind,
  StoredCodingAgentHarnessRecord,
} from "@tinyclaw/db";
import { WORKSPACE_SETTINGS_ID } from "@tinyclaw/db";

export interface CodingAgentHarnessStatus extends StoredCodingAgentHarnessRecord {
  installed: boolean;
  version: string | null;
  authenticated: boolean | null;
  ready: boolean;
  nextStep: "install" | "login" | "retry" | null;
  statusMessage: string | null;
}

interface CodingAgentInstallPlan {
  command: string;
  args: string[];
  displayCommand: string;
}

const INSTALL_PLANS: Record<StoredCodingAgentHarnessKind, CodingAgentInstallPlan> = {
  codex: {
    command: "npm",
    args: ["install", "-g", "@openai/codex"],
    displayCommand: "npm install -g @openai/codex",
  },
  claude_code: {
    command: "npm",
    args: ["install", "-g", "@anthropic-ai/claude-code"],
    displayCommand: "npm install -g @anthropic-ai/claude-code",
  },
  opencode: {
    command: "npm",
    args: ["install", "-g", "opencode-ai"],
    displayCommand: "npm install -g opencode-ai",
  },
};

export interface CodingAgentWorkspaceSettings {
  harnesses: StoredCodingAgentHarnessRecord[];
  selectedHarnessId: string | null;
}

export interface CodingAgentHarnessInstallProgress {
  harnessId: string;
  name: string;
  message: string;
}

const DEFAULT_HARNESSES: StoredCodingAgentHarnessRecord[] = [
  {
    id: "coding-harness-codex",
    kind: "codex",
    name: "Codex",
    command: "codex",
    args: [],
    enabled: true,
  },
  {
    id: "coding-harness-claude-code",
    kind: "claude_code",
    name: "Claude Code",
    command: "claude",
    args: [],
    enabled: true,
  },
  {
    id: "coding-harness-opencode",
    kind: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: [],
    enabled: true,
  },
];

export async function loadCodingAgentWorkspaceSettings(
  db: DatabaseAdapter,
): Promise<CodingAgentWorkspaceSettings> {
  const stored = await db.getWorkspaceSettings();

  return {
    harnesses: mergeHarnesses(stored?.codingAgentHarnesses ?? []),
    selectedHarnessId: stored?.selectedCodingAgentHarness ?? null,
  };
}

export async function listCodingAgentHarnessStatuses(
  db: DatabaseAdapter,
): Promise<CodingAgentHarnessStatus[]> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  return Promise.all(
    settings.harnesses.map(async (harness) => {
      const runtime = await getHarnessRuntimeStatus(harness.command);

      if (!runtime.installed) {
        return {
          ...harness,
          ...runtime,
          authenticated: null,
          ready: false,
          nextStep: "install" as const,
          statusMessage: `${harness.name} is not installed on this machine yet.`,
        };
      }

      const probe = await probeHarnessReadiness({
        ...harness,
        ...runtime,
        authenticated: null,
        ready: false,
        nextStep: null,
        statusMessage: null,
      });

      return {
        ...harness,
        ...runtime,
        authenticated: probe.authenticated,
        ready: probe.ready,
        nextStep: probe.nextStep,
        statusMessage: probe.statusMessage,
      };
    }),
  );
}

export async function saveCodingAgentWorkspaceSettings(
  db: DatabaseAdapter,
  input: {
    selectedHarnessId?: string | null;
    harnesses?: Array<{
      id: string;
      command?: string;
      enabled?: boolean;
    }>;
  },
): Promise<CodingAgentWorkspaceSettings> {
  const stored = await db.getWorkspaceSettings();
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const byId = new Map(settings.harnesses.map((harness) => [harness.id, harness]));

  const nextHarnesses = settings.harnesses.map((harness) => {
    const override = input.harnesses?.find((entry) => entry.id === harness.id);

    if (!override) {
      return harness;
    }

    return {
      ...harness,
      command: override.command?.trim() ? override.command.trim() : harness.command,
      enabled: override.enabled ?? harness.enabled,
    };
  });

  const selectedHarnessId =
    input.selectedHarnessId === undefined
      ? settings.selectedHarnessId
      : input.selectedHarnessId && byId.has(input.selectedHarnessId)
        ? input.selectedHarnessId
        : null;

  await db.upsertWorkspaceSettings({
    id: stored?.id ?? WORKSPACE_SETTINGS_ID,
    visionModel: stored?.visionModel ?? null,
    transcriptionModel: stored?.transcriptionModel ?? null,
    codingAgentHarnesses: nextHarnesses,
    selectedCodingAgentHarness: selectedHarnessId,
    updatedAt: new Date().toISOString(),
  });

  return {
    harnesses: nextHarnesses,
    selectedHarnessId,
  };
}

export async function resolveCodingAgentHarness(
  db: DatabaseAdapter,
  preferredKind?: StoredCodingAgentHarnessKind | null,
): Promise<CodingAgentHarnessStatus> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const enabled = settings.harnesses.filter((harness) => harness.enabled);

  const candidates: StoredCodingAgentHarnessRecord[] = [];

  if (preferredKind) {
    const preferred = enabled.find((harness) => harness.kind === preferredKind);

    if (preferred) {
      candidates.push(preferred);
    }
  } else if (settings.selectedHarnessId) {
    const selected = enabled.find((harness) => harness.id === settings.selectedHarnessId);

    if (selected) {
      candidates.push(selected);
    }
  }

  for (const harness of enabled) {
    if (!candidates.includes(harness)) {
      candidates.push(harness);
    }
  }

  for (const candidate of candidates) {
    const runtime = await getHarnessRuntimeStatus(candidate.command);

    if (runtime.installed) {
      return {
        ...candidate,
        ...runtime,
        authenticated: null,
        ready: true,
        nextStep: null,
        statusMessage: null,
      };
    }
  }

  if (preferredKind) {
    const preferred = enabled.find((harness) => harness.kind === preferredKind);

    if (!preferred) {
      throw new Error(`Configured coding agent '${preferredKind}' is unavailable.`);
    }

    throw new Error(`${preferred.name} is selected but not installed.`);
  }

  throw new Error(
    "No supported coding agent is installed. Install Codex, Claude Code, or OpenCode first.",
  );
}

export async function verifyCodingAgentHarness(
  db: DatabaseAdapter,
  harnessId?: string | null,
): Promise<{
  ok: boolean;
  harnessId: string | null;
  name: string | null;
  version: string | null;
  installed: boolean;
  authenticated: boolean | null;
  ready: boolean;
  nextStep: "install" | "login" | "retry" | null;
  statusMessage: string | null;
  error: string | null;
}> {
  const statuses = await listCodingAgentHarnessStatuses(db);
  const harness =
    statuses.find((entry) => entry.id === harnessId) ??
    statuses.find((entry) => entry.installed) ??
    null;

  if (!harness) {
    return {
      ok: false,
      harnessId: harnessId ?? null,
      name: null,
      version: null,
      installed: false,
      authenticated: null,
      ready: false,
      nextStep: "install",
      statusMessage: "Install a supported coding agent first.",
      error: "No supported coding agent is installed yet.",
    };
  }

  return {
    ok: harness.ready,
    harnessId: harness.id,
    name: harness.name,
    version: harness.version,
    installed: harness.installed,
    authenticated: harness.authenticated,
    ready: harness.ready,
    nextStep: harness.nextStep,
    statusMessage: harness.statusMessage,
    error: harness.installed
      ? harness.ready
        ? null
        : harness.nextStep === "login"
          ? authenticationHelpForHarness(harness.kind)
          : harness.statusMessage ?? `TinyClaw could not verify ${harness.name} yet.`
      : `${harness.name} is not installed or could not be started with \`${harness.command} --version\`.`,
  };
}

function mergeHarnesses(
  storedHarnesses: StoredCodingAgentHarnessRecord[],
): StoredCodingAgentHarnessRecord[] {
  const byKind = new Map<StoredCodingAgentHarnessKind, StoredCodingAgentHarnessRecord>();

  for (const harness of storedHarnesses) {
    byKind.set(harness.kind, harness);
  }

  return DEFAULT_HARNESSES.map((defaultHarness) => {
    const stored = byKind.get(defaultHarness.kind);

    return stored
      ? {
          ...stored,
          name: stored.name || defaultHarness.name,
          command: stored.command || defaultHarness.command,
          args: stored.args.length > 0 ? stored.args : defaultHarness.args,
        }
      : { ...defaultHarness, args: [...defaultHarness.args] };
  });
}

async function getHarnessRuntimeStatus(
  command: string,
): Promise<Pick<CodingAgentHarnessStatus, "installed" | "version">> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], {
      env: process.env,
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
    child.once("error", () => resolve({ installed: false, version: null }));
    child.once("close", (code) =>
      resolve({
        installed: code === 0,
        version: code === 0 ? extractVersion(stdout, stderr) : null,
      }),
    );
  });
}

function extractVersion(stdout: string, stderr: string): string | null {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output) {
    return null;
  }

  return output.split(/\r?\n/, 1)[0]?.trim() || null;
}

export function getCodingHarnessInstallCommand(kind: StoredCodingAgentHarnessKind): string {
  return INSTALL_PLANS[kind].displayCommand;
}

export function getCodingHarnessInstallHint(kind: StoredCodingAgentHarnessKind): string {
  if (kind === "codex") {
    return "Install the Codex CLI on this machine, then check again.";
  }

  if (kind === "claude_code") {
    return "Install Claude Code on this machine, then check again.";
  }

  return "Install OpenCode on this machine, then check again.";
}

export async function installCodingAgentHarness(
  db: DatabaseAdapter,
  harnessId: string,
  onProgress?: (progress: CodingAgentHarnessInstallProgress) => void,
): Promise<CodingAgentHarnessStatus> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const harness = settings.harnesses.find((entry) => entry.id === harnessId);

  if (!harness) {
    throw new Error("Unknown coding harness.");
  }

  const installPlan = INSTALL_PLANS[harness.kind];
  const emitProgress = (message: string) => {
    onProgress?.({
      harnessId: harness.id,
      name: harness.name,
      message,
    });
  };

  emitProgress(`Starting ${harness.name} install.`);
  emitProgress(installPlan.displayCommand);

  const result = await runInstallCommand(installPlan, emitProgress);
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

  if (result.timedOut) {
    throw new Error(`Install timed out while running ${harness.name}.`);
  }

  if (result.exitCode !== 0) {
    throw new Error(
      combinedOutput
        ? `${harness.name} install failed: ${summarizeInstallOutput(combinedOutput)}`
        : `${harness.name} install failed.`,
    );
  }

  emitProgress(`${harness.name} install finished. Refreshing readiness.`);

  const updated = (await listCodingAgentHarnessStatuses(db)).find((entry) => entry.id === harness.id);

  if (!updated) {
    throw new Error(`Installed ${harness.name}, but TinyClaw could not refresh its status.`);
  }

  return updated;
}

async function probeHarnessReadiness(
  harness: CodingAgentHarnessStatus,
): Promise<{
  authenticated: boolean | null;
  ready: boolean;
  nextStep: "login" | "retry" | null;
  statusMessage: string | null;
}> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "tinyclaw-coding-agent-probe-"));

  try {
    const result = await runProbeCommand(harness, tempDir);
    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

    if (result.timedOut) {
      return {
        authenticated: null,
        ready: false,
        nextStep: "retry",
        statusMessage: "Readiness check timed out.",
      };
    }

    if (result.exitCode === 0) {
      return {
        authenticated: true,
        ready: true,
        nextStep: null,
        statusMessage: `${harness.name} is installed and ready.`,
      };
    }

    if (looksLikeAuthenticationFailure(combinedOutput)) {
      return {
        authenticated: false,
        ready: false,
        nextStep: "login",
        statusMessage: `${harness.name} is installed but still needs login.`,
      };
    }

    return {
      authenticated: null,
      ready: false,
      nextStep: "retry",
      statusMessage: `${harness.name} is installed but the readiness check failed.`,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runProbeCommand(
  harness: CodingAgentHarnessStatus,
  cwd: string,
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const { spawn } = await import("node:child_process");
  const timeoutMs = 15_000;
  const prompt = "Reply with OK and nothing else.";
  const args = buildProbeArgs(harness, prompt, cwd);

  return new Promise((resolve) => {
    const child = spawn(harness.command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
        timedOut,
      });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    });
  });
}

function buildProbeArgs(
  harness: CodingAgentHarnessStatus,
  prompt: string,
  cwd: string,
): string[] {
  const baseArgs = [...harness.args];

  if (harness.kind === "codex") {
    return [
      ...baseArgs,
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "--color",
      "never",
      prompt,
    ];
  }

  if (harness.kind === "claude_code") {
    return [
      ...baseArgs,
      "--print",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "text",
      prompt,
    ];
  }

  return [
    ...baseArgs,
    "run",
    "--dir",
    cwd,
    "--format",
    "default",
    "--dangerously-skip-permissions",
    prompt,
  ];
}

function looksLikeAuthenticationFailure(output: string): boolean {
  return /log\s?in|login|sign\s?in|authenticate|authentication|not authenticated|api key|token|credential/i.test(
    output,
  );
}

function authenticationHelpForHarness(kind: StoredCodingAgentHarnessKind): string {
  if (kind === "codex") {
    return "Codex is installed, but it still needs authentication. Run `codex login` on this machine, then check again.";
  }

  if (kind === "claude_code") {
    return "Claude Code is installed, but it still needs authentication. Finish Claude Code login on this machine, then check again.";
  }

  return "OpenCode is installed, but it still needs authentication. Finish OpenCode login on this machine, then check again.";
}

async function runInstallCommand(
  plan: CodingAgentInstallPlan,
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
      env: process.env,
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
  const firstLine = output.split(/\r?\n/, 1)[0]?.trim() || output.trim();
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}
