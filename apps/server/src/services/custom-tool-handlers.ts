import { setTimeout as delay } from "node:timers/promises";
import type {
  ToolContext,
  ToolDefinition,
  ToolSourceResponse,
} from "@nakama/core";
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

/**
 * How many times a failed custom tool run is retried after the first attempt
 * (up to 3 attempts total) before the last error is surfaced unchanged.
 */
export const TOOL_RETRY_LIMIT = 2;

/**
 * Base backoff between attempts; each retry doubles it: 500ms, then 1s.
 */
const TOOL_RETRY_BASE_DELAY_MS = 500;

/**
 * Wraps a custom tool run with at-most-two retries and exponential backoff.
 *
 * Thrown errors (including timeouts) are transient by default and get
 * retried; an aborted `context.signal` stops immediately and is never
 * retried, including mid-backoff. Cancellation preserves the signal's reason;
 * other final failures are re-thrown unchanged.
 */
export function withToolRetries(
  run: (input: unknown, context: ToolContext) => Promise<unknown>
): (input: unknown, context: ToolContext) => Promise<unknown> {
  return async (input, context) => {
    let attempts = 0;
    for (;;) {
      context.signal?.throwIfAborted();
      try {
        return await run(input, context);
      } catch (error) {
        attempts += 1;
        context.signal?.throwIfAborted();
        if (attempts > TOOL_RETRY_LIMIT) {
          throw error;
        }
        // Rejects immediately if the signal aborts mid-backoff (including an
        // already-aborted signal), so a cancelled turn never waits out the delay.
        try {
          await delay(
            TOOL_RETRY_BASE_DELAY_MS * 2 ** (attempts - 1),
            undefined,
            { signal: context.signal }
          );
        } catch (delayError) {
          context.signal?.throwIfAborted();
          throw delayError;
        }
      }
    }
  };
}

export function getCustomToolHandler(
  handlerType: string
): CustomToolHandler | null {
  const handler =
    (CUSTOM_TOOL_HANDLERS as Record<string, CustomToolHandler>)[handlerType] ??
    null;
  if (!handler) {
    return null;
  }
  return {
    ...handler,
    // Both loader types resolve through this seam, so wrapping load here
    // applies the retry policy to JavaScript and Python in one place.
    load: async (record) => {
      const definition = await handler.load(record);
      if (!definition) {
        return null;
      }
      return { ...definition, run: withToolRetries(definition.run) };
    },
  };
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
