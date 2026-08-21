import type { ToolDefinition, ToolSourceResponse } from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";
import {
  loadJavascriptTool,
  resolveJavascriptModulePath,
  validateJavascriptToolModule,
} from "./javascript-tool-loader";
import {
  loadPythonTool,
  resolvePythonModulePath,
  validatePythonToolModule,
} from "./python-tool-loader";

// Registry of custom tool handler types. Adding a new handler type means
// adding an entry here plus its loader module — no call-site edits.
export interface CustomToolHandler {
  /** File extension required in handlerConfig.modulePath, e.g. ".py". */
  extension: string;
  /** Language tag returned by tool-source for this handler type. */
  language: ToolSourceResponse["language"];
  load(record: StoredToolRecord): Promise<ToolDefinition | null>;
  resolveModulePath(modulePath: string): string;
  validateModule(modulePath: string): Promise<void>;
}

export const CUSTOM_TOOL_HANDLERS = {
  javascript: {
    extension: ".js",
    language: "javascript",
    load: loadJavascriptTool,
    resolveModulePath: resolveJavascriptModulePath,
    validateModule: validateJavascriptToolModule,
  },
  python: {
    extension: ".py",
    language: "python",
    load: loadPythonTool,
    resolveModulePath: resolvePythonModulePath,
    validateModule: validatePythonToolModule,
  },
} satisfies Record<string, CustomToolHandler>;

export type CustomToolType = keyof typeof CUSTOM_TOOL_HANDLERS;

export function getCustomToolHandler(
  handlerType: string
): CustomToolHandler | null {
  return (
    (CUSTOM_TOOL_HANDLERS as Record<string, CustomToolHandler>)[handlerType] ??
    null
  );
}

export function isCustomToolType(
  handlerType: string
): handlerType is CustomToolType {
  return handlerType in CUSTOM_TOOL_HANDLERS;
}

/** Human-readable list of supported handler types, e.g. "javascript or python". */
export function customToolTypesLabel(): string {
  return Object.keys(CUSTOM_TOOL_HANDLERS).join(" or ");
}
