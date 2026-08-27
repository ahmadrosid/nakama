import { spawn } from "node:child_process";
import type { ToolContext } from "@nakama/core";

// Shared subprocess machinery for custom tool loaders (javascript, python).
// A registered tool can be written by any org's Super Bot profile, so both
// handler types run as a child process with an explicit env allowlist
// instead of inheriting the server's full environment.

const SIGKILL_GRACE_MS = 5000;
const MAX_OUTPUT_CHARS = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;

function resolveCustomToolTimeoutMs(): number {
  const configured = Number(process.env.NAKAMA_CUSTOM_TOOL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TIMEOUT_MS;
}

function buildAllowlistedSubprocessEnv(
  workspaceRoot?: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  if (process.env.PATH) {
    env.PATH = process.env.PATH;
  }

  if (process.env.NAKAMA_CONFIG_DIR) {
    env.NAKAMA_CONFIG_DIR = process.env.NAKAMA_CONFIG_DIR;
  }

  if (workspaceRoot) {
    env.NAKAMA_WORKSPACE_ROOT = workspaceRoot;
  }

  return env;
}

export interface SpawnJsonToolOptions {
  args: string[];
  bin: string;
  context: ToolContext;
  /** Working directory for the child. Keeps a tool's relative file access
   * scoped to its own directory instead of the server's checkout. */
  cwd: string;
  input: unknown;
  /** Used in error messages, e.g. "Python tool", "JavaScript tool". */
  label: string;
  workspaceRoot?: string;
}

/**
 * Spawns a tool as a subprocess, writes `input` as JSON to stdin, and parses
 * one JSON value from stdout as the result. Kills the child (SIGTERM, then
 * SIGKILL after a grace period) if it outlives the timeout or if
 * `context.signal` aborts.
 */
export async function spawnJsonTool(
  options: SpawnJsonToolOptions
): Promise<unknown> {
  const { args, bin, context, cwd, input, label, workspaceRoot } = options;
  const env = buildAllowlistedSubprocessEnv(workspaceRoot);
  const timeoutMs = resolveCustomToolTimeoutMs();

  const result = await new Promise<{ stderr: string; stdout: string }>(
    (resolve, reject) => {
      // Node SIGTERMs the child when the turn is cancelled, so a stopped chat
      // does not leave a tool process holding the session open.
      const child = spawn(bin, args, {
        cwd,
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
      }, timeoutMs);

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
        const tail = stderr.trim() || "(no stderr)";

        // A child that traps SIGTERM can still exit 0 after the deadline;
        // the budget is spent either way, so report the timeout.
        if (timedOut) {
          reject(
            new Error(
              `${label} timed out after ${timeoutMs}ms (exit code ${exitCode ?? "null"}): ${tail}`
            )
          );
          return;
        }

        if (exitCode === 0) {
          resolve({ stderr, stdout });
          return;
        }

        reject(new Error(`${label} exit code ${exitCode ?? "null"}: ${tail}`));
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
    throw new Error(
      `${label} produced no output; it must print its JSON result to stdout. stderr: ${result.stderr.trim() || "(empty)"}`
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${label} returned non-JSON output: ${message}; stderr: ${result.stderr.trim() || "(empty)"}`
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
