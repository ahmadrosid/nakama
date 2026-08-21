import path from "node:path";
import type { JsonSchema, ToolDefinition } from "@nakama/core";
import { permissiveObjectSchema } from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";

// Helpers shared by the custom tool loaders (javascript, python, and any
// future handler type registered in custom-tool-handlers.ts).

export function createErrorTool(
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

export function isPathInsideDirectory(
  targetPath: string,
  directoryPath: string
): boolean {
  const relative = path.relative(directoryPath, targetPath);

  return (
    relative === "" || !(relative.startsWith("..") || path.isAbsolute(relative))
  );
}

export interface CustomToolHandlerConfig {
  modulePath: string;
  parameters?: JsonSchema;
}

export function readHandlerConfig(
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

  return { modulePath, parameters };
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

export function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null;
}
