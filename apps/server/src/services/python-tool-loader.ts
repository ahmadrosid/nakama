import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolDefinition } from "@nakama/core";
import {
  getCustomToolsDir,
  pathExists,
  permissiveObjectSchema,
} from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";
import {
  createErrorTool,
  isPathInsideDirectory,
  readHandlerConfig,
} from "./custom-tool-shared";

const PYTHON_BIN = process.env.NAKAMA_PYTHON_BIN ?? "python3";
const DEFAULT_TIMEOUT_MS = 30_000;
const SIGKILL_GRACE_MS = 5000;
const MAX_OUTPUT_CHARS = 1_000_000;

export async function loadPythonTool(
  record: StoredToolRecord
): Promise<ToolDefinition | null> {
  const config = readHandlerConfig(record.handlerConfig);

  if (!config?.modulePath) {
    return createErrorTool(
      record,
      `Tool "${record.name}" is missing handlerConfig.modulePath.`
    );
  }

  let modulePath: string;

  try {
    modulePath = resolvePythonModulePath(config.modulePath);
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error)
    );
  }

  if (!(await pathExists(modulePath))) {
    return createErrorTool(
      record,
      `Tool module not found: ${config.modulePath}`
    );
  }

  // Surface the missing-`run` error at load time so the agent sees a clear
  // message instead of a confusing JSON parse error from spawn.
  try {
    await validatePythonToolModule(config.modulePath);
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error)
    );
  }

  const parameters = config.parameters ?? permissiveObjectSchema();

  return {
    description: record.description,
    name: record.name,
    parameters,
    async run(input, context) {
      return runPythonTool(modulePath, input, context);
    },
  };
}

export async function validatePythonToolModule(
  modulePath: string
): Promise<void> {
  const resolvedPath = resolvePythonModulePath(modulePath);

  if (!(await pathExists(resolvedPath))) {
    throw new Error(`Tool module not found: ${modulePath}`);
  }

  // Static check: requires a `run(` definition so the obvious failure is
  // caught at load/create time. Syntax errors still surface at invocation.
  const source = await readFile(resolvedPath, "utf8");

  if (!/\bdef\s+run\s*\(/.test(source)) {
    throw new Error("Tool module must define a run(input, context) function.");
  }
}

export function resolvePythonModulePath(modulePath: string): string {
  const toolsDir = path.resolve(getCustomToolsDir());
  const resolved = path.isAbsolute(modulePath)
    ? path.resolve(modulePath)
    : path.resolve(toolsDir, modulePath);

  if (!isPathInsideDirectory(resolved, toolsDir)) {
    throw new Error(`Tool module path must stay inside ${toolsDir}.`);
  }

  return resolved;
}

async function runPythonTool(
  modulePath: string,
  input: unknown,
  context: ToolContext
): Promise<unknown> {
  const workspaceRoot = readString(context?.workspaceRoot);
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (workspaceRoot) {
    env.NAKAMA_WORKSPACE_ROOT = workspaceRoot;
  }

  try {
    return await spawnAndParse(modulePath, input, context, env);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function spawnAndParse(
  modulePath: string,
  input: unknown,
  context: ToolContext,
  env: NodeJS.ProcessEnv
): Promise<unknown> {
  const result = await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      // Node SIGTERMs the child when the turn is cancelled, so a stopped chat
      // does not leave a python process holding the session open.
      const child = spawn(PYTHON_BIN, [modulePath], {
        env,
        signal: context.signal,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const sigtermTimer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // already exited
        }
        timedOut = true;
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // already exited
          }
        }, SIGKILL_GRACE_MS).unref();
      }, DEFAULT_TIMEOUT_MS);

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout = appendCapped(stdout, String(chunk));
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr = appendCapped(stderr, String(chunk));
      });

      // A child that exits without reading stdin can surface EPIPE here;
      // the close handler reports the real failure.
      child.stdin?.on("error", () => {});

      child.once("error", (error) => {
        clearTimeout(sigtermTimer);
        reject(error);
      });

      child.once("close", (exitCode) => {
        clearTimeout(sigtermTimer);

        if (exitCode === 0) {
          resolve({ stderr, stdout });
          return;
        }

        const tail = stderr.trim() || "(no stderr)";
        reject(
          new Error(
            `Python tool exit code ${exitCode ?? "null"}${timedOut ? " (timed out)" : ""}: ${tail}`
          )
        );
      });

      // Write the input payload and close stdin so the child can finish
      // reading and proceed to run().
      try {
        child.stdin?.end(JSON.stringify(input ?? {}));
      } catch (error) {
        clearTimeout(sigtermTimer);
        reject(error);
      }
    }
  );

  const trimmed = result.stdout.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Python tool returned non-JSON output: ${message}; stderr: ${result.stderr.trim() || "(empty)"}`
    );
  }
}

function appendCapped(current: string, next: string): string {
  const combined = current + next;

  if (combined.length <= MAX_OUTPUT_CHARS) {
    return combined;
  }

  return combined.slice(-MAX_OUTPUT_CHARS);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
