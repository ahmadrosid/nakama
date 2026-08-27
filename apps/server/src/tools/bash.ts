import { spawn } from "node:child_process";
import {
  mkdir,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  getProfileSoulDir,
  guardFilePath,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import { mergeCodingAgentSpawnEnv } from "../services/coding-agent-spawn-env";
import {
  type BashBackendKind,
  resolveBashBackend,
  resolveBashSandboxImage,
  resolveBashSandboxNetwork,
} from "./bash-config";
import { buildBashSandboxEnv } from "./bash-sandbox-env";
import {
  commandLooksLikeCursorAgent,
  formatCodingAgentBashStdout,
} from "./cursor-agent-output";
import {
  BASH_SANDBOX_GUEST_WORKSPACE,
  ProfileSandboxManager,
} from "./profile-sandbox-manager";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_OUTPUT_CHARS = 32_000;
/** In-memory capture for coding-agent runs before summarize / keep-tail. */
const CODING_AGENT_MAX_CAPTURE_CHARS = 5_000_000;
/** Keep the newest N coding-agent logs; prune the rest after each write. */
const CODING_AGENT_LOG_RETENTION = 10;

export interface BashInput {
  codingAgent?: boolean;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface BashOutput {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

interface BashRunOptions {
  /** Override backend for tests. */
  backend?: BashBackendKind;
  /** Reuse a manager across calls (tests). */
  sandboxManager?: ProfileSandboxManager;
  workspaceRoot?: string;
}

interface ShellRunOptions {
  codingAgentMode: boolean;
  signal?: AbortSignal;
  workspaceRoot: string;
}

let sharedSandboxManager: ProfileSandboxManager | null = null;

async function getSandboxManager(): Promise<ProfileSandboxManager> {
  if (sharedSandboxManager) {
    return sharedSandboxManager;
  }

  const { createDefaultMicrosandboxRuntime } = await import(
    "./bash-microsandbox-runtime"
  );
  sharedSandboxManager = new ProfileSandboxManager(
    createDefaultMicrosandboxRuntime()
  );
  return sharedSandboxManager;
}

/** Test helper to clear the process-wide warm-sandbox manager. */
export function resetBashSandboxManagerForTests(): void {
  sharedSandboxManager = null;
}

const BASH_TOOL_DESCRIPTION_BASE =
  "Run a one-off shell command in the active profile workspace and return stdout, stderr, and exit code. Do not use this to create persistent tools, tool files, shell wrappers, or .sh scripts. If the user wants a reusable tool, translate shell examples into JavaScript instead.";

function bashToolDescription(): string {
  try {
    if (resolveBashBackend() === "microsandbox") {
      return `${BASH_TOOL_DESCRIPTION_BASE} Public network is denied by default. codingAgent harness runs are unsupported on this backend.`;
    }
  } catch {
    // Invalid backend config — keep the host description.
  }
  return BASH_TOOL_DESCRIPTION_BASE;
}

export const bashTool: ToolDefinition<BashInput, BashOutput> = {
  description: bashToolDescription(),
  name: "bash",
  parameters: {
    additionalProperties: false,
    properties: {
      codingAgent: {
        description:
          "When true, Nakama merges coding-agent spawn env (provider passthrough) for this command.",
        type: "boolean",
      },
      command: { description: "Shell command to run.", type: "string" },
      cwd: {
        description:
          "Optional working directory within the profile workspace. Defaults to the profile workspace root.",
        type: "string",
      },
      env: {
        additionalProperties: { type: "string" },
        description:
          "Optional environment variables to merge into the spawned shell process.",
        type: "object",
      },
      timeoutMs: {
        description:
          "Timeout in milliseconds. Defaults to 30000, max 1800000 (30 minutes).",
        type: "number",
      },
    },
    required: ["command"],
    type: "object",
  },
  run(input, context) {
    return runBash(input, context);
  },
};

export async function runBash(
  input: unknown,
  context: ToolContext,
  options: BashRunOptions = {}
): Promise<BashOutput> {
  const profileId = context.profileId?.trim();
  const orgId = context.orgId?.trim();
  if (!profileId) {
    throw new Error("profileId is required.");
  }
  if (!orgId) {
    throw new Error("orgId is required.");
  }

  const command = readString(input, "command");
  if (!command) {
    throw new Error("command is required.");
  }

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId)
  );
  const rawCwd = readString(input, "cwd");
  const cwd = rawCwd
    ? (
        await guardFilePath(rawCwd, workspaceRoot, undefined, {
          allowedDirs: [workspaceRoot],
          cwd: workspaceRoot,
        })
      ).resolved
    : workspaceRoot;
  const timeoutMs = readTimeout(readOptionalNumber(input, "timeoutMs"));
  const env = readStringRecord(readOptionalRecord(input, "env"));
  const codingAgentMode =
    readOptionalBoolean(input, "codingAgent") === true ||
    commandLooksLikeCursorAgent(command);

  const backend = options.backend ?? resolveBashBackend();

  if (backend === "microsandbox" && codingAgentMode) {
    throw new Error(
      "codingAgent is unsupported when NAKAMA_BASH_BACKEND=microsandbox. Use NAKAMA_BASH_BACKEND=host for coding-agent harness runs."
    );
  }

  if (backend === "microsandbox") {
    const manager = options.sandboxManager ?? (await getSandboxManager());
    return manager.run({
      command,
      env: buildBashSandboxEnv({
        overrides: env,
        workspaceRoot: BASH_SANDBOX_GUEST_WORKSPACE,
      }),
      hostCwd: cwd,
      hostWorkspace: workspaceRoot,
      image: resolveBashSandboxImage(),
      network: resolveBashSandboxNetwork(),
      orgId,
      profileId,
      signal: context.signal,
      timeoutMs,
    });
  }

  return runShellCommand(command, cwd, timeoutMs, env, {
    codingAgentMode,
    signal: context.signal,
    workspaceRoot,
  });
}

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  envOverrides: Record<string, string> = {},
  options: ShellRunOptions
): Promise<BashOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: mergeCodingAgentSpawnEnv(process.env, envOverrides),
      // SIGTERMs the shell when the turn is cancelled, so a stopped chat does not
      // leave an ffmpeg or coding-agent run holding the session turn open.
      signal: options.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutOverflow = false;
    let stderrOverflow = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (options.codingAgentMode) {
        const next = appendCodingAgentCapture(stdout, String(chunk));
        stdout = next.value;
        stdoutOverflow = stdoutOverflow || next.overflowed;
        return;
      }

      stdout = appendOutput(stdout, String(chunk));
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (options.codingAgentMode) {
        const next = appendCodingAgentCapture(stderr, String(chunk));
        stderr = next.value;
        stderrOverflow = stderrOverflow || next.overflowed;
        return;
      }

      stderr = appendOutput(stderr, String(chunk));
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutId);

      void finalizeCodingAgentOutput({
        codingAgentMode: options.codingAgentMode,
        exitCode,
        stderr,
        stderrOverflow,
        stdout,
        stdoutOverflow,
        timedOut,
        workspaceRoot: options.workspaceRoot,
      })
        .then(resolve)
        .catch(reject);
    });
  });
}

async function finalizeCodingAgentOutput(args: {
  codingAgentMode: boolean;
  workspaceRoot: string;
  stdout: string;
  stderr: string;
  stdoutOverflow: boolean;
  stderrOverflow: boolean;
  exitCode: number | null;
  timedOut: boolean;
}): Promise<BashOutput> {
  if (!args.codingAgentMode) {
    return {
      exitCode: args.exitCode,
      stderr: args.stderr,
      stdout: args.stdout,
      timedOut: args.timedOut,
    };
  }

  const logPath = await writeCodingAgentLog(
    args.workspaceRoot,
    args.stdout,
    args.stderr
  );
  let stdout = formatCodingAgentBashStdout(args.stdout, {
    exitCode: args.exitCode,
    logPath,
  });
  if (args.stdoutOverflow) {
    stdout = `${stdout}\n\n(stdout capture hit ${CODING_AGENT_MAX_CAPTURE_CHARS} char limit; see full log)`;
  }

  let stderr = keepTail(args.stderr, MAX_OUTPUT_CHARS);
  if (args.stderrOverflow) {
    stderr = `${stderr}\n\n(stderr capture hit ${CODING_AGENT_MAX_CAPTURE_CHARS} char limit; see full log)`;
  }

  return {
    exitCode: args.exitCode,
    stderr,
    stdout,
    timedOut: args.timedOut,
  };
}

async function writeCodingAgentLog(
  workspaceRoot: string,
  stdout: string,
  stderr: string
): Promise<string | null> {
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error(
      "workspaceRoot must be an absolute path; relative roots resolve against process.cwd() and break profile isolation."
    );
  }
  try {
    const dir = path.join(workspaceRoot, "artifacts", "coding-agent-runs");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${stamp}-${Math.random().toString(36).slice(2, 8)}.log`;
    const absolutePath = path.join(dir, fileName);
    const body = [
      "=== stdout ===",
      stdout,
      "",
      "=== stderr ===",
      stderr,
      "",
    ].join("\n");
    await writeFile(absolutePath, body, "utf8");
    await pruneCodingAgentLogs(dir);
    return path.join("artifacts", "coding-agent-runs", fileName);
  } catch {
    return null;
  }
}

async function pruneCodingAgentLogs(dir: string): Promise<void> {
  const names = await readdir(dir);
  const logs = names.filter((name) => name.endsWith(".log"));
  if (logs.length <= CODING_AGENT_LOG_RETENTION) {
    return;
  }

  const ranked = await Promise.all(
    logs.map(async (name) => {
      try {
        const info = await stat(path.join(dir, name));
        return { mtimeMs: info.mtimeMs, name };
      } catch {
        return { mtimeMs: 0, name };
      }
    })
  );
  ranked.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1));

  for (const stale of ranked.slice(CODING_AGENT_LOG_RETENTION)) {
    await unlink(path.join(dir, stale.name)).catch(() => undefined);
  }
}

function appendOutput(current: string, chunk: string): string {
  const combined = current + chunk;

  if (combined.length <= MAX_OUTPUT_CHARS) {
    return combined;
  }

  return combined.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]";
}

function appendCodingAgentCapture(
  current: string,
  chunk: string
): { value: string; overflowed: boolean } {
  if (current.length >= CODING_AGENT_MAX_CAPTURE_CHARS) {
    return { overflowed: true, value: current };
  }

  const remaining = CODING_AGENT_MAX_CAPTURE_CHARS - current.length;
  if (chunk.length <= remaining) {
    return { overflowed: false, value: current + chunk };
  }

  return {
    overflowed: true,
    value: current + chunk.slice(0, remaining),
  };
}

function keepTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `...[truncated]\n${value.slice(value.length - maxChars)}`;
}

async function resolveWorkspaceRoot(rawWorkspaceRoot: string): Promise<string> {
  if (!path.isAbsolute(rawWorkspaceRoot)) {
    throw new Error(
      "workspaceRoot must be an absolute path; relative roots resolve against process.cwd() and break profile isolation."
    );
  }
  try {
    return await realpath(rawWorkspaceRoot);
  } catch {
    return rawWorkspaceRoot;
  }
}

function readTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(value, MAX_TIMEOUT_MS);
}

function readOptionalNumber(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return;
  }

  return (input as Record<string, unknown>)[key];
}

function readOptionalBoolean(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return;
  }

  return (input as Record<string, unknown>)[key];
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalRecord(
  input: unknown,
  key: string
): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readStringRecord(
  record: Record<string, unknown> | null
): Record<string, string> {
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value] as const] : []
    )
  );
}
