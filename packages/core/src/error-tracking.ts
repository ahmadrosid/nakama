import { createHash, randomUUID } from "node:crypto";
import { NAKAMA_API_VERSION } from "./contract";
import { isErrorTrackingEnabled } from "./error-tracking-config";
import {
  appendPendingErrorReport,
  readPendingErrorReports,
  removePendingErrorReport,
} from "./error-tracking-queue";
import { scrubText } from "./error-tracking-scrub";

/**
 * "test" is the event the Integrations tab sends to prove a DSN works. It rides the
 * same pipeline so the operator is checking the real path, and carries a lower level
 * at the ingest so it never sits in a triage queue next to real crashes.
 *
 * "tool" is a custom tool that failed every attempt in its retry budget. The process
 * survives it, so it is tagged apart from a crash and the operator can filter on it.
 */
export type ErrorReportKind = "crash" | "test" | "tool";

export interface ErrorReport {
  at: string;
  fingerprint: string;
  /** Doubles as the Sentry event id, so a report delivered twice collapses into one. */
  id: string;
  kind: ErrorReportKind;
  message: string;
  name: string;
  runtime: { apiVersion: number; bun: string; platform: string; arch: string };
  source: string;
  stack?: string;
}

/**
 * Returns whether the report actually reached the ingest. A sink with nowhere to
 * send returns false rather than resolving quietly, so "not delivered" can never
 * be mistaken for success and drop the report off the queue.
 */
export type ErrorSink = (report: ErrorReport) => boolean | Promise<boolean>;

let enabled = false;

/**
 * Cached so reportError can decide synchronously, before it writes anything, whether
 * the integration is on. Refreshed at startup and whenever the DSN is saved, so
 * turning it on does not need a restart.
 */
export async function refreshErrorTrackingEnabled(): Promise<boolean> {
  enabled = await isErrorTrackingEnabled();
  return enabled;
}

function normalizeMessage(message: string): string {
  return (
    message
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        "<uuid>"
      )
      // Mixed letter-and-digit runs are nakama ids (prof_01J..., nanoid). Leaving them in
      // gives every occurrence its own fingerprint, which is the one failure mode that
      // makes deduplication useless. Over-merging is the safer direction: name and top
      // frame still keep genuinely different bugs apart.
      .replace(
        /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{8,}\b/g,
        "<id>"
      )
      .replace(/'[^']*'|"[^"]*"/g, "<str>")
      // Not \b\d+\b: there is no word boundary inside "30000ms", and timeout messages
      // are the most common place a varying number shows up.
      .replace(/\d+/g, "<n>")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Line and column are deliberately dropped. Keeping them splits one bug into a new
 * fingerprint on every release that shifts the file, which defeats deduplication.
 */
function topApplicationFrame(stack: string | undefined): string {
  if (!stack) {
    return "";
  }

  for (const line of stack.split("\n").slice(1)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("at ")) {
      continue;
    }

    if (trimmed.includes("node_modules") || trimmed.includes("node:")) {
      continue;
    }

    return trimmed.replace(/:\d+:\d+(\)?)$/, "$1").replace(/\s+/g, " ");
  }

  return "";
}

export function fingerprintError(
  name: string,
  message: string,
  stack: string | undefined
): string {
  const parts = [name, normalizeMessage(message), topApplicationFrame(stack)];
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

function errorToParts(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message || String(error),
      name: error.name || "Error",
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  if (typeof error === "string") {
    return { message: error, name: "NonError" };
  }

  try {
    return {
      message: JSON.stringify(error) ?? String(error),
      name: "NonError",
    };
  } catch {
    // Circular and other unserializable values all land on "[object Object]", so they
    // share one fingerprint. Accepted: separating them needs a walk of the object, and
    // a rejection with a circular non-Error is rare enough not to pay for it.
    return { message: String(error), name: "NonError" };
  }
}

export interface ReportErrorOptions {
  kind?: ErrorReportKind;
  source?: string;
}

export function buildErrorReport(
  error: unknown,
  options: ReportErrorOptions = {}
): ErrorReport {
  const parts = errorToParts(error);
  const stack = parts.stack ? scrubText(parts.stack) : undefined;

  return {
    fingerprint: fingerprintError(parts.name, parts.message, parts.stack),
    id: randomUUID(),
    kind: options.kind ?? "crash",
    message: scrubText(parts.message),
    name: parts.name,
    ...(stack ? { stack } : {}),
    at: new Date().toISOString(),
    runtime: {
      apiVersion: NAKAMA_API_VERSION,
      arch: process.arch,
      bun: Bun.version,
      platform: process.platform,
    },
    source: options.source ?? "unknown",
  };
}

let sink: ErrorSink | null = null;

export function setErrorSink(next: ErrorSink | null): void {
  sink = next;
}

/**
 * Never throws. It does await the send, bounded by the sink's own timeout, because the
 * unhandled-rejection handler has to know delivery finished before it exits. Everything
 * up to and including the queue write happens synchronously, so a caller that does not
 * await still leaves the report somewhere recoverable.
 */
export async function reportError(
  error: unknown,
  options: ReportErrorOptions = {}
): Promise<ErrorReport> {
  const report = buildErrorReport(error, options);

  try {
    // Unscrubbed on purpose: this never leaves the machine, and a redacted local log
    // is useless to the person debugging their own install.
    console.error(
      `[nakama:${report.kind}] ${report.source} ${report.fingerprint}`,
      error
    );
  } catch {
    // A closed stderr must not turn one crash into two.
  }

  const currentSink = sink;

  if (!(enabled && currentSink)) {
    // Nothing configured to deliver to, so nothing is written anywhere either. The
    // local log above is the whole behaviour when the integration is off.
    return report;
  }

  // Queued before the send, not after it. An uncaught exception kills the process while
  // the send is still in flight, and the queue is the only thing that survives that.
  appendPendingErrorReport(report);

  try {
    if (await currentSink(report)) {
      removePendingErrorReport(report.id);
    }
  } catch {
    // Left queued for the next process to retry.
  }

  return report;
}

/**
 * Drains what the last process could not deliver. Call once at startup, after the sink
 * is installed.
 */
export async function flushPendingErrorReports(): Promise<number> {
  const currentSink = sink;

  if (!currentSink) {
    return 0;
  }

  let delivered = 0;

  for (const report of readPendingErrorReports()) {
    try {
      if (await currentSink(report)) {
        removePendingErrorReport(report.id);
        delivered += 1;
      }
    } catch {
      // Stays queued. Nothing else to try until the next start.
    }
  }

  return delivered;
}

/**
 * Uses uncaughtExceptionMonitor rather than uncaughtException: the monitor observes the
 * error and leaves Bun's own crash-and-exit behaviour intact. Listening to
 * uncaughtException would swallow the crash and leave a half-dead process behind.
 *
 * unhandledRejection has no monitor variant, and merely listening suppresses Bun's
 * default exit(1), so the exit is re-applied by hand below.
 */
export function installErrorHandlers(source: string): () => void {
  const onUncaught = (error: unknown) => {
    void reportError(error, { source });
  };

  const onRejection = (reason: unknown) => {
    void reportError(reason, { source }).finally(() => {
      process.exit(1);
    });
  };

  process.on("uncaughtExceptionMonitor", onUncaught);
  process.on("unhandledRejection", onRejection);

  return () => {
    process.off("uncaughtExceptionMonitor", onUncaught);
    process.off("unhandledRejection", onRejection);
  };
}
