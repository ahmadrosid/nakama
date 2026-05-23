import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { JsonSchema, ToolContext, ToolDefinition } from "@tinyclaw/core";
import { getCustomToolsDir, permissiveObjectSchema } from "@tinyclaw/core";
import type { StoredToolRecord } from "@tinyclaw/db";

const moduleCache = new Map<string, JavascriptToolModule>();

export interface JavascriptToolHandlerConfig {
  modulePath: string;
  parameters?: JsonSchema;
}

interface JavascriptToolModule {
  parameters?: JsonSchema;
  run: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export async function loadJavascriptTool(
  record: StoredToolRecord,
): Promise<ToolDefinition | null> {
  const config = readJavascriptHandlerConfig(record.handlerConfig);

  if (!config?.modulePath) {
    return createErrorTool(
      record,
      `Tool "${record.name}" is missing handlerConfig.modulePath.`,
    );
  }

  let modulePath: string;

  try {
    modulePath = resolveJavascriptModulePath(config.modulePath);
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    await access(modulePath);
  } catch {
    return createErrorTool(
      record,
      `Tool module not found: ${config.modulePath}`,
    );
  }

  try {
    const module = await importJavascriptModule(modulePath);
    const parameters =
      module.parameters ?? config.parameters ?? permissiveObjectSchema();

    return {
      name: record.name,
      description: record.description,
      parameters,
      async run(input, context) {
        return module.run(input, context);
      },
    };
  } catch (error) {
    return createErrorTool(
      record,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function validateJavascriptToolModule(modulePath: string): Promise<void> {
  const resolvedPath = resolveJavascriptModulePath(modulePath);

  try {
    await access(resolvedPath);
  } catch {
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

function readJavascriptHandlerConfig(
  handlerConfig: unknown,
): JavascriptToolHandlerConfig | null {
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

  const parameters =
    isJsonSchema(record.parameters) ? record.parameters : undefined;

  return { modulePath, parameters };
}

async function importJavascriptModule(
  modulePath: string,
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

  return {
    parameters,
    run: (input, context) => Promise.resolve(run(input, context)),
  };
}

function createErrorTool(record: StoredToolRecord, message: string): ToolDefinition {
  return {
    name: record.name,
    description: record.description,
    parameters: permissiveObjectSchema(),
    async run() {
      return { error: message };
    },
  };
}

function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, targetPath);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null;
}
