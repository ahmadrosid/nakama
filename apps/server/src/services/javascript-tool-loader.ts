import path from "node:path";
import { pathToFileURL } from "node:url";
import type { JsonSchema, ToolContext, ToolDefinition } from "@nakama/core";
import {
  getCustomToolsDir,
  pathExists,
  permissiveObjectSchema,
} from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";
import {
  createErrorTool,
  isJsonSchema,
  isPathInsideDirectory,
  readHandlerConfig,
} from "./custom-tool-shared";

const moduleCache = new Map<string, JavascriptToolModule>();

interface JavascriptToolModule {
  parallelSafe?: boolean;
  parameters?: JsonSchema;
  run: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export async function loadJavascriptTool(
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
    modulePath = resolveJavascriptModulePath(config.modulePath);
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

  try {
    const module = await importJavascriptModule(modulePath);
    const parameters =
      module.parameters ?? config.parameters ?? permissiveObjectSchema();

    return {
      description: record.description,
      name: record.name,
      parameters,
      ...(module.parallelSafe ? { parallelSafe: true } : {}),
      async run(input, context) {
        return module.run(input, context);
      },
    };
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function validateJavascriptToolModule(
  modulePath: string
): Promise<void> {
  const resolvedPath = resolveJavascriptModulePath(modulePath);

  if (!(await pathExists(resolvedPath))) {
    throw new Error(`Tool module not found: ${modulePath}`);
  }

  await importJavascriptModule(resolvedPath);
}

export function resolveJavascriptModulePath(modulePath: string): string {
  const toolsDir = path.resolve(getCustomToolsDir());
  const resolved = path.isAbsolute(modulePath)
    ? path.resolve(modulePath)
    : path.resolve(toolsDir, modulePath);

  if (!isPathInsideDirectory(resolved, toolsDir)) {
    throw new Error(`Tool module path must stay inside ${toolsDir}.`);
  }

  return resolved;
}

async function importJavascriptModule(
  modulePath: string
): Promise<JavascriptToolModule> {
  const cached = moduleCache.get(modulePath);

  if (cached) {
    return cached;
  }

  const imported = await import(pathToFileURL(modulePath).href);
  const module = normalizeJavascriptModule(imported);

  moduleCache.set(modulePath, module);
  return module;
}

export function invalidateJavascriptModuleCache(modulePath: string): void {
  moduleCache.delete(modulePath);
}

function normalizeJavascriptModule(imported: unknown): JavascriptToolModule {
  if (typeof imported !== "object" || imported === null) {
    throw new Error("Tool module must export a run function.");
  }

  const record = imported as Record<string, unknown>;
  const defaultExport =
    typeof record.default === "object" && record.default !== null
      ? (record.default as Record<string, unknown>)
      : null;
  const source = defaultExport ?? record;
  const run = source.run;

  if (typeof run !== "function") {
    throw new Error("Tool module must export a run function.");
  }

  const parameters = isJsonSchema(source.parameters)
    ? source.parameters
    : isJsonSchema(record.parameters)
      ? record.parameters
      : undefined;
  const parallelSafe =
    source.parallelSafe === true || record.parallelSafe === true;

  return {
    parameters,
    ...(parallelSafe ? { parallelSafe: true } : {}),
    run: (input, context) => Promise.resolve(run(input, context)),
  };
}
