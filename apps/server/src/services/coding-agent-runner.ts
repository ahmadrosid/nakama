import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  getProfileSoulDir,
  guardFilePath,
  readBundledSkillBody,
  type ToolContext,
} from "@nakama/core";
import type { DatabaseAdapter, StoredCodingAgentHarnessKind } from "@nakama/db";
import { resolveCodingAgentHarness, type CodingAgentHarnessStatus } from "./coding-agent-harness-service";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 48_000;

export interface DelegateCodingTaskInput {
  task: string;
  backend?: StoredCodingAgentHarnessKind;
  cwd?: string;
  timeoutMs?: number;
}

export interface DelegateCodingTaskResult {
  backend: StoredCodingAgentHarnessKind;
  harnessName: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  success: boolean;
}

export async function runCodingAgentTask(
  db: DatabaseAdapter,
  input: unknown,
  context: ToolContext,
): Promise<DelegateCodingTaskResult> {
  const task = readString(input, "task");

  if (!task) {
    throw new Error("task is required.");
  }

  const profileId = context.profileId?.trim();
  const orgId = context.orgId?.trim();

  if (!profileId) {
    throw new Error("profileId is required.");
  }

  if (!orgId) {
    throw new Error("orgId is required.");
  }

  const workspaceRoot = context.workspaceRoot?.trim() || getProfileSoulDir(orgId, profileId);
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
  const backend = readBackend(input);
  const harness = await resolveCodingAgentHarness(db, backend);
  const prompt = await buildDelegationPrompt(task, harness.kind);

  return runHarness(harness, prompt, cwd, timeoutMs);
}

async function runHarness(
  harness: CodingAgentHarnessStatus,
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<DelegateCodingTaskResult> {
  const command = harness.command;
  const baseArgs = [...harness.args];

  if (harness.kind === "codex") {
    return runCodex(command, baseArgs, harness, prompt, cwd, timeoutMs);
  }

  if (harness.kind === "claude_code") {
    return runProcess(
      command,
      [
        ...baseArgs,
        "--print",
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "text",
        prompt,
      ],
      cwd,
      timeoutMs,
      harness,
    );
  }

  return runProcess(
    command,
    [
      ...baseArgs,
      "run",
      "--dir",
      cwd,
      "--format",
      "default",
      "--dangerously-skip-permissions",
      prompt,
    ],
    cwd,
    timeoutMs,
    harness,
  );
}

async function runCodex(
  command: string,
  baseArgs: string[],
  harness: CodingAgentHarnessStatus,
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<DelegateCodingTaskResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "nakama-codex-"));
  const outputFile = path.join(tempDir, "last-message.txt");

  try {
    const result = await runProcess(
      command,
      [
        ...baseArgs,
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "never",
        "--color",
        "never",
        "--output-last-message",
        outputFile,
        prompt,
      ],
      cwd,
      timeoutMs,
      harness,
    );
    const lastMessage = await readFile(outputFile, "utf8").catch(() => "");

    return {
      ...result,
      stdout: lastMessage.trim() || result.stdout,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  harness: CodingAgentHarnessStatus,
): Promise<DelegateCodingTaskResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
        backend: harness.kind,
        harnessName: harness.name,
        command,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        success: exitCode === 0 && !timedOut,
      });
    });
  });
}

async function buildDelegationPrompt(
  task: string,
  backend: StoredCodingAgentHarnessKind,
): Promise<string> {
  const sharedSkill = await readBundledSkillBody("coding-delegation");
  const backendSkill = await readBundledSkillBody(getBackendSkillName(backend));

  return [
    "You are a delegated coding agent working inside the current project workspace.",
    "",
    "# Delegation Guidance",
    sharedSkill,
    "",
    "# Backend Guidance",
    backendSkill,
    "",
    "Task:",
    task.trim(),
  ].join("\n");
}

function getBackendSkillName(
  backend: StoredCodingAgentHarnessKind,
): "coding-backend-codex" | "coding-backend-claude-code" | "coding-backend-opencode" {
  if (backend === "codex") {
    return "coding-backend-codex";
  }

  if (backend === "claude_code") {
    return "coding-backend-claude-code";
  }

  return "coding-backend-opencode";
}

function appendOutput(current: string, chunk: string): string {
  const combined = current + chunk;

  if (combined.length <= MAX_OUTPUT_CHARS) {
    return combined;
  }

  return combined.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]";
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

function readBackend(input: unknown): StoredCodingAgentHarnessKind | null {
  const value = readString(input, "backend");

  if (value === "codex" || value === "claude_code" || value === "opencode") {
    return value;
  }

  return null;
}

function readTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(value, 30 * 60_000);
}
