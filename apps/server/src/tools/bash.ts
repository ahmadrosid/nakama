import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import {
  getProfileSoulDir,
  guardFilePath,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import { mergeCodingAgentSpawnEnv } from "../services/coding-agent-spawn-env";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_OUTPUT_CHARS = 32_000;

export interface BashInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  codingAgent?: boolean;
  env?: Record<string, string>;
}

export interface BashOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface BashRunOptions {
  workspaceRoot?: string;
}

export const bashTool: ToolDefinition<BashInput, BashOutput> = {
  name: "bash",
  description:
    "Run a one-off shell command in the active profile workspace and return stdout, stderr, and exit code. Do not use this to create persistent tools, tool files, shell wrappers, or .sh scripts. If the user wants a reusable tool, translate shell examples into JavaScript instead.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run." },
      cwd: {
        type: "string",
        description:
          "Optional working directory within the profile workspace. Defaults to the profile workspace root.",
      },
      timeoutMs: {
        type: "number",
        description: "Timeout in milliseconds. Defaults to 30000, max 1800000 (30 minutes).",
      },
      codingAgent: {
        type: "boolean",
        description:
          "When true, Nakama merges coding-agent spawn env (model gateway routing) for this command.",
      },
      env: {
        type: "object",
        description: "Optional environment variables to merge into the spawned shell process.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  run(input, context) {
    return runBash(input, context);
  },
};

export async function runBash(
  input: unknown,
  context: ToolContext,
  options: BashRunOptions = {},
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
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId),
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

  return runShellCommand(command, cwd, timeoutMs, env);
}

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  envOverrides: Record<string, string> = {},
): Promise<BashOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: mergeCodingAgentSpawnEnv(process.env, envOverrides),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = appendOutput(stdout, String(chunk));
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = appendOutput(stderr, String(chunk));
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function appendOutput(current: string, chunk: string): string {
  const combined = current + chunk;

  if (combined.length <= MAX_OUTPUT_CHARS) {
    return combined;
  }

  return combined.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]";
}

async function resolveWorkspaceRoot(rawWorkspaceRoot: string): Promise<string> {
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
    return undefined;
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

function readOptionalRecord(input: unknown, key: string): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readStringRecord(record: Record<string, unknown> | null): Record<string, string> {
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value] as const] : [],
    ),
  );
}
