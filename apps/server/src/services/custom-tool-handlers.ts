import { setTimeout as delay } from "node:timers/promises";
import type {
  ToolContext,
  ToolDefinition,
  ToolSourceResponse,
} from "@nakama/core";
import { reportError } from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";
import { resolveCustomToolModulePath } from "./custom-tool-shared";
import {
  loadJavascriptTool,
  validateJavascriptToolModule,
} from "./javascript-tool-loader";
import { loadPythonTool, validatePythonToolModule } from "./python-tool-loader";

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
    resolveModulePath: resolveCustomToolModulePath,
    validateModule: validateJavascriptToolModule,
  },
  python: {
    extension: ".py",
    language: "python",
    load: loadPythonTool,
    resolveModulePath: resolveCustomToolModulePath,
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
 * Subprocess exit code that opts a custom tool into retries (sysexits
 * `EX_TEMPFAIL`). Any other non-zero exit is treated as permanent — the tool
 * may already have performed a side effect.
 */
export const TOOL_RETRYABLE_EXIT_CODE = 75;

/**
 * Base backoff between attempts; each retry doubles it: 500ms, then 1s.
 */
const TOOL_RETRY_BASE_DELAY_MS = 500;

/** Node errno codes that mean the child never started or the socket never got going. */
const RETRYABLE_SPAWN_ERRNOS = new Set([
  "EAGAIN",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
]);

/**
 * Explicit opt-in for a transient custom-tool failure. Arbitrary thrown errors
 * are permanent by default so a write-then-throw path is never replayed.
 */
export class RetryableToolError extends Error {
  readonly retryable = true as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RetryableToolError";
  }
}

/**
 * Only errors that opt into retries (or known pre-start spawn errno codes)
 * are replayed. Timeouts, exit codes other than {@link TOOL_RETRYABLE_EXIT_CODE},
 * validation failures, and plain `Error` throws are permanent.
 */
function isRetryableToolError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ((error as { retryable?: unknown }).retryable === true) {
    return true;
  }
  if (
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return RETRYABLE_SPAWN_ERRNOS.has((error as { code: string }).code);
  }
  return false;
}

/**
 * Wraps a custom tool run with at-most-two retries and exponential backoff.
 *
 * Retries only {@link isRetryableToolError} failures. Arbitrary throws,
 * timeouts, and ordinary non-zero exits are permanent on the first attempt so
 * a tool that already wrote data is not replayed. An aborted `context.signal`
 * stops immediately and is never retried, including mid-backoff. Cancellation
 * preserves the signal's reason; other final failures are re-thrown unchanged.
 *
 * A final failure (exhausted retryable budget, or a permanent error) is also
 * mirrored to the operator's error tracker, tagged `tool:<name>`.
 */
export function withToolRetries(
  run: (input: unknown, context: ToolContext) => Promise<unknown>,
  toolName: string
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
        const canRetry =
          isRetryableToolError(error) && attempts <= TOOL_RETRY_LIMIT;
        if (!canRetry) {
          // Not awaited: reportError queues synchronously and never throws, and
          // the model should not wait out the tracker's HTTP timeout on a turn
          // that has already failed.
          void reportError(error, { kind: "tool", source: `tool:${toolName}` });
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
      return {
        ...definition,
        run: withToolRetries(definition.run, definition.name),
      };
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
