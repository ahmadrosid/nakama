import path from "node:path";
import type { JsonSchema, ToolContext, ToolDefinition } from "@nakama/core";
import { getCustomToolsDir, permissiveObjectSchema } from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";

// Helpers shared by the custom tool loaders (javascript, python, and any
// future handler type registered in custom-tool-handlers.ts).

function createErrorTool(
  record: StoredToolRecord,
  message: string
): ToolDefinition {
  return {
    description: record.description,
    name: record.name,
    parameters: permissiveObjectSchema(),
    async run() {
      return { error: message };
    },
  };
}

export function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Shared load path for javascript/python subprocess tools. */
export async function loadCustomSubprocessTool(options: {
  allowParallelSafe?: boolean;
  record: StoredToolRecord;
  resolveModulePath: (modulePath: string) => string;
  run: (
    modulePath: string,
    input: unknown,
    context: ToolContext
  ) => Promise<unknown>;
  validateModule: (modulePath: string) => Promise<void>;
}): Promise<ToolDefinition | null> {
  const { allowParallelSafe, record, resolveModulePath, run, validateModule } =
    options;
  const config = readHandlerConfig(record.handlerConfig);

  if (!config?.modulePath) {
    return createErrorTool(
      record,
      `Tool "${record.name}" is missing handlerConfig.modulePath.`
    );
  }

  let modulePath: string;

  try {
    modulePath = resolveModulePath(config.modulePath);
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error)
    );
  }

  // validateModule owns the missing-file check so load does not pathExists twice.
  try {
    await validateModule(config.modulePath);
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error)
    );
  }

  return {
    description: record.description,
    name: record.name,
    parameters: config.parameters ?? permissiveObjectSchema(),
    ...(allowParallelSafe && config.parallelSafe ? { parallelSafe: true } : {}),
    async run(input, context) {
      return run(modulePath, input, context);
    },
  };
}

function isPathInsideDirectory(
  targetPath: string,
  directoryPath: string
): boolean {
  const relative = path.relative(directoryPath, targetPath);

  return (
    relative === "" || !(relative.startsWith("..") || path.isAbsolute(relative))
  );
}

interface CustomToolHandlerConfig {
  modulePath: string;
  parallelSafe?: boolean;
  parameters?: JsonSchema;
}

function readHandlerConfig(
  handlerConfig: unknown
): CustomToolHandlerConfig | null {
  if (typeof handlerConfig !== "object" || handlerConfig === null) {
    return null;
  }

  const record = handlerConfig as Record<string, unknown>;
  const modulePath =
    typeof record.modulePath === "string" && record.modulePath.trim()
      ? record.modulePath.trim()
      : null;

  if (!modulePath) {
    return null;
  }

  const parameters = isJsonSchema(record.parameters)
    ? record.parameters
    : undefined;
  const parallelSafe = record.parallelSafe === true;

  return { modulePath, parallelSafe, parameters };
}

export function readHandlerModulePath(handlerConfig: unknown): string | null {
  if (typeof handlerConfig !== "object" || handlerConfig === null) {
    return null;
  }

  const modulePath = (handlerConfig as Record<string, unknown>).modulePath;

  if (typeof modulePath !== "string" || !modulePath.trim()) {
    return null;
  }

  return modulePath.trim();
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null;
}

export function resolveCustomToolModulePath(modulePath: string): string {
  const toolsDir = path.resolve(getCustomToolsDir());
  const resolved = path.isAbsolute(modulePath)
    ? path.resolve(modulePath)
    : path.resolve(toolsDir, modulePath);

  if (!isPathInsideDirectory(resolved, toolsDir)) {
    throw new Error(`Tool module path must stay inside ${toolsDir}.`);
  }

  return resolved;
}
