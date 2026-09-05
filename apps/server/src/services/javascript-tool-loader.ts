import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolContext, ToolDefinition } from "@nakama/core";
import { pathExists } from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";
import {
  loadCustomSubprocessTool,
  readOptionalString,
  resolveCustomToolModulePath,
} from "./custom-tool-shared";
import { spawnJsonTool } from "./custom-tool-subprocess";

const BUN_BIN = process.env.NAKAMA_BUN_BIN ?? "bun";
const RUNNER_PATH = fileURLToPath(
  new URL("./javascript-tool-runner.js", import.meta.url)
);

export async function loadJavascriptTool(
  record: StoredToolRecord
): Promise<ToolDefinition | null> {
  return loadCustomSubprocessTool({
    allowParallelSafe: true,
    record,
    resolveModulePath: resolveCustomToolModulePath,
    run: runJavascriptTool,
    validateModule: validateJavascriptToolModule,
  });
}

export async function validateJavascriptToolModule(
  modulePath: string
): Promise<void> {
  const resolvedPath = resolveCustomToolModulePath(modulePath);

  if (!(await pathExists(resolvedPath))) {
    throw new Error(`Tool module not found: ${modulePath}`);
  }

  // Static checks catch the obvious authoring failures before registration.
  // Syntax errors still surface at invocation.
  const source = await readFile(resolvedPath, "utf8");

  if (
    !/\bexport\s+(?:async\s+)?function\s+run\s*\(|\bexport\s+(?:const|let|var)\s+run\s*=/.test(
      source
    )
  ) {
    throw new Error("Tool module must export a run(input, context) function.");
  }
}

async function runJavascriptTool(
  modulePath: string,
  input: unknown,
  context: ToolContext
): Promise<unknown> {
  // No try/catch here on purpose: a failed spawn must reject so the retry
  // policy in withToolRetries can retry transient failures. executeToolCall
  // converts the throw into `{ error: message }`.
  return spawnJsonTool({
    args: [RUNNER_PATH, modulePath],
    bin: BUN_BIN,
    context,
    cwd: path.dirname(modulePath),
    input,
    label: "JavaScript tool",
    workspaceRoot: readOptionalString(context?.workspaceRoot),
  });
}
