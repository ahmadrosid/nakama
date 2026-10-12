import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
import { getToolExecutionEnv } from "../lib/ensure-process-path";
import { mergeCodingAgentSpawnEnv } from "../services/coding-agent-spawn-env";
import { killProcessTree } from "../services/custom-tool-subprocess";
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

const EXIT_STDIO_GRACE_MS = 100;

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

  const { MicrosandboxBashRuntime } = await import(
    "./bash-microsandbox-runtime"
  );

  sharedSandboxManager = new ProfileSandboxManager(
    new MicrosandboxBashRuntime()
  );

  return sharedSandboxManager;
}

/** Test helper to clear the process-wide warm-sandbox manager. */
export function resetBashSandboxManagerForTests(): void {
  sharedSandboxManager = null;
}

const BASH_TOOL_DESCRIPTION_BASE =
  "Run a one-off shell command and return stdout, stderr, and exit code. In local CLI sessions, commands start in the directory where the CLI was launched; otherwise they start in the active profile workspace. Do not use this to create persistent tools, tool files, shell wrappers, or .sh scripts. If the user wants a reusable tool, translate shell examples into JavaScript instead.";

function bashToolDescription(): string {
  try {
    if (resolveBashBackend() === "microsandbox") {
      return `${BASH_TOOL_DESCRIPTION_BASE} Commands run under /bin/sh (POSIX ash on alpine — not bash; no [[ ]], arrays, or pipefail). Public network is denied by default. codingAgent harness runs are unsupported on this backend.`;
    }
  } catch {
    // Invalid backend config — keep the host description.
  }

  return `${BASH_TOOL_DESCRIPTION_BASE} Host execution is unrestricted by Nakama and uses the server process's OS permissions. Commands can access files outside the profile workspace, including other profiles' files when OS permissions allow. Assign host bash only to trusted profiles.`;
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
          "Optional working directory within the active shell workspace. Defaults to the CLI launch directory in local CLI sessions, or the profile workspace otherwise.",
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
  input: BashInput,
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

  const command = input.command.trim();

  if (!command) {
    throw new Error("command is required.");
  }

  const codingAgentMode =
    input.codingAgent === true || commandLooksLikeCursorAgent(command);

  const codingWorkspace =
    context.channel === "cli" || codingAgentMode
      ? context.codingWorkspaceRoot
      : undefined;

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ??
      codingWorkspace ??
      context.workspaceRoot ??
      getProfileSoulDir(orgId, profileId)
  );

  const rawCwd = input.cwd?.trim() ?? "";

  const cwd = rawCwd
    ? (
        await guardFilePath(rawCwd, workspaceRoot, undefined, {
          allowedDirs: [workspaceRoot],
          cwd: workspaceRoot,
        })
      ).resolved
    : workspaceRoot;

  const timeoutMs = readTimeout(input.timeoutMs);
  const env = input.env ?? {};

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

export function resolveHostBash(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
  which: (name: string) => string | null = Bun.which
): string {
  if (platform !== "win32") {
    const shell = exists("/bin/bash") ? "/bin/bash" : which("bash");

    if (shell) {
      return shell;
    }

    throw new Error("No Bash shell found. Install Bash and add it to PATH.");
  }

  for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"]]) {
    if (root) {
      // Use Bash itself, rather than Git's launcher, so its PID owns the tree.
      const shell = path.win32.join(root, "Git", "usr", "bin", "bash.exe");

      if (exists(shell)) {
        return shell;
      }
    }
  }

  const shell = which("bash.exe");

  // The WSL launcher uses a different filesystem and toolchain from the host.
  if (
    shell &&
    !/^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/i.test(
      shell.replaceAll("/", "\\")
    )
  ) {
    return shell;
  }

  throw new Error(
    "No native Bash shell found. Install Git for Windows (https://git-scm.com/download/win) or add a native Bash executable to PATH."
  );
}

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  envOverrides: Record<string, string> = {},
  options: ShellRunOptions
): Promise<BashOutput> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const env = mergeCodingAgentSpawnEnv(getToolExecutionEnv(), envOverrides);

    // A login shell may rebuild PATH from /etc/profile, as Debian in the Docker
    // image does. Put back the dirs the harness probe finds CLIs in, after the
    // profile's own so nothing that resolved before changes.
    const restorePath =
      process.platform !== "win32" && env.PATH
        ? 'PATH="$PATH:$NAKAMA_TOOL_PATH"; unset NAKAMA_TOOL_PATH; '
        : "";

    const child = spawn(resolveHostBash(), ["-lc", restorePath + command], {
      cwd,
      detached: process.platform !== "win32",
      env: restorePath ? { ...env, NAKAMA_TOOL_PATH: env.PATH } : env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutOverflow = false;
    let stderrOverflow = false;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let exited = false;
    let settled = false;
    let abortHandled = false;
    let treeKilled: Promise<void> | undefined;

    const killCommand = () => {
      treeKilled ??= killProcessTree(child, "SIGKILL");
    };

    const onAbort = () => {
      if (abortHandled) {
        return;
      }

      abortHandled = true;
      killCommand();
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (options.signal?.aborted) {
      onAbort();
    }

    const timeoutId = setTimeout(() => {
      timedOut = true;
      killCommand();
    }, timeoutMs);

    // A descendant may retain the pipes after the shell exits. Keep draining
    // active output, but release idle inherited handles like Pi does.
    const armExitTimer = () => {
      if (exited && !settled) {
        clearTimeout(exitTimer);
        exitTimer = setTimeout(
          () => finish(child.exitCode),
          EXIT_STDIO_GRACE_MS
        );
      }
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      armExitTimer();

      if (options.codingAgentMode) {
        const next = appendCodingAgentCapture(stdout, String(chunk));
        stdout = next.value;
        stdoutOverflow = stdoutOverflow || next.overflowed;

        return;
      }

      stdout = appendOutput(stdout, String(chunk));
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      armExitTimer();

      if (options.codingAgentMode) {
        const next = appendCodingAgentCapture(stderr, String(chunk));
        stderr = next.value;
        stderrOverflow = stderrOverflow || next.overflowed;

        return;
      }

      stderr = appendOutput(stderr, String(chunk));
    });

    async function finish(exitCode: number | null, error?: Error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      clearTimeout(exitTimer);
      options.signal?.removeEventListener("abort", onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      // The shell can exit before taskkill finishes terminating descendants.
      await treeKilled;

      if (error || abortHandled) {
        reject(
          error ?? new DOMException("The operation was aborted", "AbortError")
        );

        return;
      }

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
    }

    child.once("error", (error) => finish(null, error));
    child.once("exit", () => {
      exited = true;
      armExitTimer();
    });
    child.once("close", (exitCode) => finish(exitCode));
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

interface CodingAgentCapture {
  overflowed: boolean;
  value: string;
}

function appendCodingAgentCapture(
  current: string,
  chunk: string
): CodingAgentCapture {
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

function readTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(value, MAX_TIMEOUT_MS);
}
