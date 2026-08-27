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

const PYTHON_BIN = process.env.NAKAMA_PYTHON_BIN ?? "python3";

export async function loadPythonTool(
  record: StoredToolRecord
): Promise<ToolDefinition | null> {
  return loadCustomSubprocessTool({
    record,
    resolveModulePath: resolvePythonModulePath,
    run: runPythonTool,
    validateModule: validatePythonToolModule,
  });
}

export async function validatePythonToolModule(
  modulePath: string
): Promise<void> {
  const resolvedPath = resolvePythonModulePath(modulePath);

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

export function resolvePythonModulePath(modulePath: string): string {
  return resolveCustomToolModulePath(modulePath);
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
    bin: PYTHON_BIN,
    context,
    cwd: path.dirname(modulePath),
    input,
    label: "Python tool",
    workspaceRoot: readOptionalString(context?.workspaceRoot),
  });
}
