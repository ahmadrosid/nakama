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
const ALLOWED_WINDOWS_PYTHON_BASENAME = /^python(\d+(\.\d+)*)?(\.exe)?$/i;

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

/** A python.org install directory such as `Python313` or `Python313-arm64`. */
const WINDOWS_PYTHON_VERSION_DIR = /^\d+(-\w+)?\\/;

function pythonBasenamePattern(): RegExp {
  return process.platform === "win32"
    ? ALLOWED_WINDOWS_PYTHON_BASENAME
    : ALLOWED_PYTHON_BASENAME;
}

/**
 * The python.org installer roots: per user, all users, and the legacy
 * `C:\PythonXY` layout. The POSIX prefixes are not reused here because a
 * drive-less `/usr/bin/python` that fails realpath would still spawn
 * `C:\usr\bin\python.exe`, and any local user can create that folder.
 */
function isOnWindowsPythonAllowlist(resolved: string): boolean {
  const candidate = path.win32.normalize(resolved).toLowerCase();
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;

  if (
    localAppData &&
    candidate.startsWith(
      `${path.win32.join(localAppData, "Programs", "Python")}\\`.toLowerCase()
    )
  ) {
    return true;
  }

  return [programFiles && path.win32.join(programFiles, "Python"), "C:\\Python"]
    .filter((prefix): prefix is string => Boolean(prefix))
    .some((prefix) => {
      const lowered = prefix.toLowerCase();
      return (
        candidate.startsWith(lowered) &&
        WINDOWS_PYTHON_VERSION_DIR.test(candidate.slice(lowered.length))
      );
    });
}

/**
 * Resolve NAKAMA_PYTHON_BIN (or the default `python3`, `python` on Windows)
 * against the allowlist. Called at spawn time so tests can change the env
 * without reloading the module.
 */
export function resolvePythonBin(
  raw: string | undefined = process.env.NAKAMA_PYTHON_BIN
): string {
  // Windows installers put `python.exe` on PATH; `python3` there is usually
  // the Microsoft Store stub, which exits 49 without running anything.
  const value =
    raw?.trim() || (process.platform === "win32" ? "python" : "python3");

  if (value.includes("\0")) {
    throw new Error("NAKAMA_PYTHON_BIN contains a null byte.");
  }

  if (!(value.includes("/") || value.includes("\\"))) {
    if (!pythonBasenamePattern().test(value)) {
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
    // The native call also expands 8.3 short names (`C:\PROGRA~1`) on Windows,
    // which the JS realpath leaves as typed.
    resolved =
      process.platform === "win32"
        ? realpathSync.native(value)
        : realpathSync(value);
  } catch {
    // Missing binary fails later at spawn; still enforce basename + prefix.
  }

  const basename = path.basename(resolved);
  if (!pythonBasenamePattern().test(basename)) {
    throw new Error(
      `NAKAMA_PYTHON_BIN basename must match python or python3…; got "${basename}".`
    );
  }

  const allowed =
    process.platform === "win32"
      ? isOnWindowsPythonAllowlist(resolved)
      : ALLOWED_PYTHON_PATH_PREFIXES.some((prefix) => {
          if (prefix.endsWith("/")) {
            return (
              resolved === prefix.slice(0, -1) || resolved.startsWith(prefix)
            );
          }
          // Homebrew Cellar formula dirs are `python` or `python@3.x` — require a
          // path boundary so `…/Cellar/pythonfoo` cannot sneak through.
          return (
            resolved === prefix ||
            resolved.startsWith(`${prefix}/`) ||
            resolved.startsWith(`${prefix}@`)
          );
        });

  if (!allowed) {
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

  // Nothing is asserted about how the result is written. `print(json.dumps(...))`
  // reaches stdout without naming it, and spawnJsonTool already reports a tool
  // that writes nothing, accurately, when it happens.
  const hasHarness =
    /if\s+__name__\s*==\s*["']__main__["']\s*:/.test(source) &&
    source.includes("sys.stdin");
  if (!hasHarness) {
    throw new Error(
      'Python tools must include an if __name__ == "__main__" harness that reads JSON from sys.stdin.'
    );
  }
}

async function runPythonTool(
  modulePath: string,
  input: unknown,
  context: ToolContext,
  apiKey?: string
): Promise<unknown> {
  // No try/catch here on purpose: a failed spawn must reject so the retry
  // policy in withToolRetries can retry explicitly opt-in transient failures
  // (RetryableToolError / exit 75). executeToolCall converts the throw into
  // `{ error: message }`.
  return spawnJsonTool({
    apiKey,
    args: [modulePath],
    bin: resolvePythonBin(),
    context,
    cwd: path.dirname(modulePath),
    input,
    label: "Python tool",
    workspaceRoot: readOptionalString(context?.workspaceRoot),
  });
}
