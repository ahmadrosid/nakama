import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  DatabaseAdapter,
  StoredCodingAgentHarnessKind,
  StoredCodingAgentHarnessProbeCache,
  StoredCodingAgentHarnessRecord,
} from "@nakama/db";
import { WORKSPACE_SETTINGS_ID } from "@nakama/db";
import { ensureProcessPath, ensureBunGlobalInstallDirs, getToolExecutionEnv } from "../lib/ensure-process-path";

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

const HARNESS_PACKAGES: Record<StoredCodingAgentHarnessKind, string> = {
  codex: "@openai/codex",
  claude_code: "@anthropic-ai/claude-code",
  opencode: "opencode-ai",
};

function detectCodingHarnessPackageManager(): "npm" | "bun" {
  if (Bun.which("npm")) {
    return "npm";
  }

  if (Bun.which("bun")) {
    return "bun";
  }

  return "npm";
}

export function buildCodingHarnessInstallPlan(
  kind: StoredCodingAgentHarnessKind,
  packageManager: "npm" | "bun" = detectCodingHarnessPackageManager(),
): CodingAgentInstallPlan {
  const pkg = HARNESS_PACKAGES[kind];

  if (packageManager === "bun") {
    return {
      command: "bun",
      args: ["install", "-g", "--trust", pkg],
      displayCommand: `bun install -g --trust ${pkg}`,
    };
  }

  return {
    command: "npm",
    args: ["install", "-g", pkg],
    displayCommand: `npm install -g ${pkg}`,
  };
}

export interface CodingAgentWorkspaceSettings {
  harnesses: StoredCodingAgentHarnessRecord[];
  selectedHarnessId: string | null;
}

const PROBE_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ListCodingAgentHarnessStatusesOptions {
  /** When true, run live readiness probes for installed harnesses. Default false (use cache). */
  probe?: boolean;
  /** When set with probe, only probe this harness id. */
  harnessId?: string | null;
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
  options: ListCodingAgentHarnessStatusesOptions = {},
): Promise<CodingAgentHarnessStatus[]> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const probe = options.probe ?? false;
  const probeHarnessId = options.harnessId ?? null;

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

      const shouldProbe =
        probe && (probeHarnessId === null || probeHarnessId === harness.id);

      if (!shouldProbe) {
        return buildHarnessStatusFromCache(harness, runtime);
      }

      const probed = await probeHarnessReadiness({
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
        authenticated: probed.authenticated,
        ready: probed.ready,
        nextStep: probed.nextStep,
        statusMessage: probed.statusMessage,
      };
    }),
  );
}

export async function refreshCodingAgentHarnessProbe(
  db: DatabaseAdapter,
  harnessId: string,
): Promise<CodingAgentHarnessStatus> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const harness = settings.harnesses.find((entry) => entry.id === harnessId);

  if (!harness) {
    throw new Error("Unknown coding harness.");
  }

  const runtime = await getHarnessRuntimeStatus(harness.command);

  if (!runtime.installed) {
    await clearHarnessProbeCache(db, harnessId);

    return {
      ...harness,
      ...runtime,
      authenticated: null,
      ready: false,
      nextStep: "install",
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

  const checkedAt = new Date().toISOString();
  const probeCache: StoredCodingAgentHarnessProbeCache = {
    checkedAt,
    authenticated: probe.authenticated,
    ready: probe.ready,
    nextStep: probe.nextStep,
    statusMessage: probe.statusMessage,
  };

  await saveHarnessProbeCache(db, harnessId, probeCache);

  return {
    ...harness,
    ...runtime,
    authenticated: probe.authenticated,
    ready: probe.ready,
    nextStep: probe.nextStep,
    statusMessage: probe.statusMessage,
    probeCache,
  };
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

export function isCodingAgentCommand(
  command: string,
  harnesses: Array<Pick<StoredCodingAgentHarnessRecord, "command" | "enabled">>,
): boolean {
  const trimmed = command.trim();

  for (const harness of harnesses) {
    if (!harness.enabled) {
      continue;
    }

    const binary = harness.command.trim();

    if (!binary) {
      continue;
    }

    if (trimmed === binary || trimmed.startsWith(`${binary} `)) {
      return true;
    }
  }

  return false;
}

export async function resolveCodingAgentHarness(
  db: DatabaseAdapter,
  preferredKind?: StoredCodingAgentHarnessKind | null,
): Promise<CodingAgentHarnessStatus> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const statuses = await listCodingAgentHarnessStatuses(db);
  const enabled = statuses.filter((harness) => harness.enabled);
  const readyHarnesses = enabled.filter((harness) => harness.ready);

  const notReadyError = (harness: CodingAgentHarnessStatus): Error => {
    if (!harness.installed) {
      return new Error(`${harness.name} is selected but not installed.`);
    }

    const message =
      harness.statusMessage ??
      (harness.nextStep === "login"
        ? authenticationHelpForHarness(harness.kind)
        : `${harness.name} is not ready.`);

    return new Error(message);
  };

  const ensureReady = async (harness: CodingAgentHarnessStatus): Promise<CodingAgentHarnessStatus> => {
    if (harness.ready && isProbeCacheFresh(harness.probeCache)) {
      return harness;
    }

    const refreshed = await refreshCodingAgentHarnessProbe(db, harness.id);

    if (refreshed.ready) {
      return refreshed;
    }

    throw notReadyError(refreshed);
  };

  if (preferredKind) {
    const preferred = enabled.find((harness) => harness.kind === preferredKind);

    if (!preferred) {
      throw new Error(`Configured coding agent '${preferredKind}' is unavailable.`);
    }

    return ensureReady(preferred);
  }

  if (!settings.selectedHarnessId) {
    if (readyHarnesses.length === 1) {
      return ensureReady(readyHarnesses[0]!);
    }
  } else {
    const selected = enabled.find((harness) => harness.id === settings.selectedHarnessId);

    if (selected) {
      return ensureReady(selected);
    }
  }

  const fallbackReady = readyHarnesses[0];

  if (fallbackReady) {
    return ensureReady(fallbackReady);
  }

  const selected = settings.selectedHarnessId
    ? enabled.find((harness) => harness.id === settings.selectedHarnessId)
    : undefined;
  const installed = selected?.installed ? selected : enabled.find((harness) => harness.installed);

  if (installed) {
    return ensureReady(installed);
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
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const targetHarnessId =
    harnessId ??
    settings.selectedHarnessId ??
    settings.harnesses.find((entry) => entry.enabled)?.id ??
    null;

  if (!targetHarnessId) {
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

  let harness: CodingAgentHarnessStatus;

  try {
    harness = await refreshCodingAgentHarnessProbe(db, targetHarnessId);
  } catch {
    return {
      ok: false,
      harnessId: targetHarnessId,
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
          : harness.statusMessage ?? `Nakama could not verify ${harness.name} yet.`
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

function isProbeCacheFresh(
  cache: StoredCodingAgentHarnessProbeCache | null | undefined,
): boolean {
  if (!cache?.checkedAt) {
    return false;
  }

  const checkedAt = Date.parse(cache.checkedAt);

  if (Number.isNaN(checkedAt)) {
    return false;
  }

  return Date.now() - checkedAt < PROBE_CACHE_TTL_MS;
}

function buildHarnessStatusFromCache(
  harness: StoredCodingAgentHarnessRecord,
  runtime: Pick<CodingAgentHarnessStatus, "installed" | "version">,
): CodingAgentHarnessStatus {
  const cache = harness.probeCache;

  if (cache) {
    return {
      ...harness,
      ...runtime,
      authenticated: cache.authenticated,
      ready: cache.ready,
      nextStep: cache.nextStep,
      statusMessage: cache.statusMessage,
    };
  }

  return {
    ...harness,
    ...runtime,
    authenticated: null,
    ready: false,
    nextStep: null,
    statusMessage: null,
  };
}

async function saveHarnessProbeCache(
  db: DatabaseAdapter,
  harnessId: string,
  probeCache: StoredCodingAgentHarnessProbeCache,
): Promise<void> {
  const stored = await db.getWorkspaceSettings();
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const nextHarnesses = settings.harnesses.map((harness) =>
    harness.id === harnessId ? { ...harness, probeCache } : harness,
  );

  await db.upsertWorkspaceSettings({
    id: stored?.id ?? WORKSPACE_SETTINGS_ID,
    visionModel: stored?.visionModel ?? null,
    transcriptionModel: stored?.transcriptionModel ?? null,
    codingAgentHarnesses: nextHarnesses,
    selectedCodingAgentHarness: settings.selectedHarnessId,
    updatedAt: new Date().toISOString(),
  });
}

async function clearHarnessProbeCache(db: DatabaseAdapter, harnessId: string): Promise<void> {
  const stored = await db.getWorkspaceSettings();
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const nextHarnesses = settings.harnesses.map((harness) =>
    harness.id === harnessId ? { ...harness, probeCache: null } : harness,
  );

  await db.upsertWorkspaceSettings({
    id: stored?.id ?? WORKSPACE_SETTINGS_ID,
    visionModel: stored?.visionModel ?? null,
    transcriptionModel: stored?.transcriptionModel ?? null,
    codingAgentHarnesses: nextHarnesses,
    selectedCodingAgentHarness: settings.selectedHarnessId,
    updatedAt: new Date().toISOString(),
  });
}

async function getHarnessRuntimeStatus(
  command: string,
): Promise<Pick<CodingAgentHarnessStatus, "installed" | "version">> {
  const initial = await probeHarnessVersion(command);

  if (initial.installed || !initial.missing) {
    return {
      installed: initial.installed,
      version: initial.version,
    };
  }

  ensureProcessPath();
  const retried = await probeHarnessVersion(command);

  return {
    installed: retried.installed,
    version: retried.version,
  };
}

async function probeHarnessVersion(command: string): Promise<{
  installed: boolean;
  version: string | null;
  missing: boolean;
}> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], {
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

function extractVersion(stdout: string, stderr: string): string | null {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output) {
    return null;
  }

  return output.split(/\r?\n/, 1)[0]?.trim() || null;
}

export function getCodingHarnessInstallCommand(kind: StoredCodingAgentHarnessKind): string {
  return buildCodingHarnessInstallPlan(kind).displayCommand;
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

  const installPlan = buildCodingHarnessInstallPlan(harness.kind);
  if (installPlan.command === "bun") {
    ensureBunGlobalInstallDirs();
  }
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

  const updated = await refreshCodingAgentHarnessProbe(db, harness.id);

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
  const tempDir = await mkdtemp(path.join(tmpdir(), "nakama-coding-agent-probe-"));

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
      env: getToolExecutionEnv(),
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
