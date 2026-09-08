import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolDefinition } from "@nakama/core";
import { pathExists } from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";
import {
  loadCustomSubprocessTool,
  readOptionalString,
  resolveCustomToolModulePath,
} from "./custom-tool-shared";
import { spawnJsonTool } from "./custom-tool-subprocess";

/** Bare interpreter names allowed when NAKAMA_PYTHON_BIN has no path. */
const ALLOWED_PYTHON_BASENAME = /^python(\d+(\.\d+)*)?$/;

/**
 * Absolute interpreter paths must resolve under one of these prefixes after
 * realpath (covers Homebrew Cellar symlinks). Anything else is rejected so an
 * operator cannot point NAKAMA_PYTHON_BIN at an arbitrary host binary (#593).
 */
const ALLOWED_PYTHON_PATH_PREFIXES = [
  "/usr/bin/",
  "/usr/local/bin/",
  "/opt/homebrew/bin/",
  "/opt/homebrew/Cellar/python",
  "/home/linuxbrew/.linuxbrew/bin/",
  "/home/linuxbrew/.linuxbrew/Cellar/python",
] as const;

/**
 * Resolve NAKAMA_PYTHON_BIN (or the default `python3`) against the allowlist.
 * Called at spawn time so tests can change the env without reloading the module.
 */
export function resolvePythonBin(
  raw: string | undefined = process.env.NAKAMA_PYTHON_BIN
): string {
  const value = raw?.trim() || "python3";

  if (value.includes("\0")) {
    throw new Error("NAKAMA_PYTHON_BIN contains a null byte.");
  }

  if (!(value.includes("/") || value.includes("\\"))) {
    if (!ALLOWED_PYTHON_BASENAME.test(value)) {
      throw new Error(
        `NAKAMA_PYTHON_BIN bare name must match python or python3…; got "${value}".`
      );
    }
    return value;
  }

  if (!path.isAbsolute(value)) {
    throw new Error(
      `NAKAMA_PYTHON_BIN must be an absolute path or a bare name (python3); got "${value}".`
    );
  }

  let resolved = value;
  try {
    resolved = realpathSync(value);
  } catch {
    // Missing binary fails later at spawn; still enforce basename + prefix.
  }

  const basename = path.basename(resolved);
  if (!ALLOWED_PYTHON_BASENAME.test(basename)) {
    throw new Error(
      `NAKAMA_PYTHON_BIN basename must match python or python3…; got "${basename}".`
    );
  }

  if (
    !ALLOWED_PYTHON_PATH_PREFIXES.some(
      (prefix) =>
        resolved === prefix.slice(0, -1) || resolved.startsWith(prefix)
    )
  ) {
    throw new Error(
      `NAKAMA_PYTHON_BIN path is not on the server allowlist: "${value}".`
    );
  }

  return value;
}

export async function loadPythonTool(
  record: StoredToolRecord
): Promise<ToolDefinition | null> {
  return loadCustomSubprocessTool({
    record,
    resolveModulePath: resolveCustomToolModulePath,
    run: runPythonTool,
    validateModule: validatePythonToolModule,
  });
}

export async function validatePythonToolModule(
  modulePath: string
): Promise<void> {
  const resolvedPath = resolveCustomToolModulePath(modulePath);

  if (!(await pathExists(resolvedPath))) {
    throw new Error(`Tool module not found: ${modulePath}`);
  }

  // Static checks catch the obvious authoring failures before registration.
  // Syntax errors still surface at invocation.
  const source = await readFile(resolvedPath, "utf8");

  if (!/\bdef\s+run\s*\(/.test(source)) {
    throw new Error("Tool module must define a run(input, context) function.");
  }

  const hasHarness =
    /if\s+__name__\s*==\s*["']__main__["']\s*:/.test(source) &&
    source.includes("sys.stdin") &&
    source.includes("sys.stdout");
  if (!hasHarness) {
    throw new Error(
      'Python tools must include an if __name__ == "__main__" harness that reads JSON from sys.stdin and writes JSON to sys.stdout.'
    );
  }
}

async function runPythonTool(
  modulePath: string,
  input: unknown,
  context: ToolContext
): Promise<unknown> {
  // No try/catch here on purpose: a failed spawn must reject so the retry
  // policy in withToolRetries can retry transient failures. executeToolCall
  // converts the throw into `{ error: message }`.
  return spawnJsonTool({
    args: [modulePath],
    bin: resolvePythonBin(),
    context,
    cwd: path.dirname(modulePath),
    input,
    label: "Python tool",
    workspaceRoot: readOptionalString(context?.workspaceRoot),
  });
}
