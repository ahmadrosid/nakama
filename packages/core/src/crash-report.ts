import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { NAKAMA_API_VERSION } from "./contract";
import { currentCrashReportConsent, isCrashReportingAllowed } from "./crash-report-config";
import {
  appendPendingCrashReport,
  clearPendingCrashReports,
  readPendingCrashReports,
  recordLastCrashReport,
} from "./crash-report-pending";
import { hashId, scrubBreadcrumbData, scrubText } from "./crash-report-scrub";

/**
 * "crash" is something that threw. "invariant" is something that returned normally but
 * broke a promise the system makes: an automation that never finished, a worker that
 * stopped reporting, a turn that produced no output. The second kind is what users
 * actually notice and never report, so it shares this pipeline rather than getting one
 * of its own.
 */
export type CrashReportKind = "crash" | "invariant";

export const MAX_BREADCRUMBS = 50;

export interface Breadcrumb {
  at: number;
  kind: string;
  data?: Record<string, string | number | boolean>;
}

export interface CrashContext {
  requestId: string;
  source: string;
  route?: string;
  orgIdHash?: string;
  userIdHash?: string;
  sessionIdHash?: string;
  breadcrumbs: Breadcrumb[];
}

export interface CrashReport {
  kind: CrashReportKind;
  fingerprint: string;
  name: string;
  message: string;
  stack?: string;
  source: string;
  requestId?: string;
  route?: string;
  orgIdHash?: string;
  userIdHash?: string;
  sessionIdHash?: string;
  breadcrumbs: Breadcrumb[];
  runtime: { apiVersion: number; bun: string; platform: string; arch: string };
  at: string;
}

export type CrashSink = (report: CrashReport) => void | Promise<void>;
export type CrashLogger = (report: CrashReport, error: unknown) => void;

const storage = new AsyncLocalStorage<CrashContext>();

export function createCrashContext(seed: {
  source: string;
  requestId?: string;
  route?: string;
}): CrashContext {
  return {
    requestId: seed.requestId?.trim() || randomUUID(),
    source: seed.source,
    ...(seed.route ? { route: seed.route } : {}),
    breadcrumbs: [],
  };
}

export function runWithCrashContext<T>(context: CrashContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentCrashContext(): CrashContext | undefined {
  return storage.getStore();
}

export function setCrashContextIds(ids: {
  orgId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
}): void {
  const context = storage.getStore();

  if (!context) {
    return;
  }

  const orgIdHash = hashId(ids.orgId);
  const userIdHash = hashId(ids.userId);
  const sessionIdHash = hashId(ids.sessionId);

  if (orgIdHash) {
    context.orgIdHash = orgIdHash;
  }

  if (userIdHash) {
    context.userIdHash = userIdHash;
  }

  if (sessionIdHash) {
    context.sessionIdHash = sessionIdHash;
  }
}

/**
 * Memory only, and thrown away when the request finishes without an error. Nothing is
 * written to disk on the happy path, which is what keeps this cheap enough that nobody
 * has a reason to turn it off.
 */
export function breadcrumb(kind: string, data?: Record<string, unknown>): void {
  const context = storage.getStore();

  if (!context) {
    return;
  }

  const scrubbed = scrubBreadcrumbData(data);

  context.breadcrumbs.push({
    at: Date.now(),
    kind,
    ...(scrubbed ? { data: scrubbed } : {}),
  });

  if (context.breadcrumbs.length > MAX_BREADCRUMBS) {
    context.breadcrumbs.shift();
  }
}

function normalizeMessage(message: string): string {
  return (
    message
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
      // Mixed letter-and-digit runs are nakama ids (prof_01J..., nanoid). Leaving them in
      // gives every occurrence its own fingerprint, which is the one failure mode that
      // makes deduplication useless. Over-merging is the safer direction: name and top
      // frame still keep genuinely different bugs apart.
      .replace(
        /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{8,}\b/g,
        "<id>",
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
  stack: string | undefined,
): string {
  const parts = [name, normalizeMessage(message), topApplicationFrame(stack)];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function errorToParts(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  if (typeof error === "string") {
    return { name: "NonError", message: error };
  }

  try {
    return { name: "NonError", message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { name: "NonError", message: String(error) };
  }
}

export interface ReportErrorOptions {
  kind?: CrashReportKind;
  source?: string;
  context?: CrashContext;
}

export function buildCrashReport(
  error: unknown,
  options: ReportErrorOptions = {},
): CrashReport {
  const context = options.context ?? storage.getStore();
  const parts = errorToParts(error);
  const stack = parts.stack ? scrubText(parts.stack) : undefined;

  return {
    kind: options.kind ?? "crash",
    fingerprint: fingerprintError(parts.name, parts.message, parts.stack),
    name: parts.name,
    message: scrubText(parts.message),
    ...(stack ? { stack } : {}),
    source: options.source ?? context?.source ?? "unknown",
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.route ? { route: context.route } : {}),
    ...(context?.orgIdHash ? { orgIdHash: context.orgIdHash } : {}),
    ...(context?.userIdHash ? { userIdHash: context.userIdHash } : {}),
    ...(context?.sessionIdHash ? { sessionIdHash: context.sessionIdHash } : {}),
    breadcrumbs: context?.breadcrumbs ? [...context.breadcrumbs] : [],
    runtime: {
      apiVersion: NAKAMA_API_VERSION,
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
    },
    at: new Date().toISOString(),
  };
}

function defaultLogger(report: CrashReport, error: unknown): void {
  // The local log carries the unscrubbed error on purpose: it never leaves the machine,
  // and a redacted local log is useless for the person debugging their own install.
  console.error(
    `[nakama:${report.kind}] ${report.source} ${report.fingerprint}` +
      `${report.requestId ? ` req=${report.requestId}` : ""}` +
      `${report.route ? ` route=${report.route}` : ""}`,
    error,
  );
}

let logger: CrashLogger = defaultLogger;
let sink: CrashSink | null = null;

export function setCrashLogger(next: CrashLogger | null): void {
  logger = next ?? defaultLogger;
}

export function setCrashSink(next: CrashSink | null): void {
  sink = next;
}

/**
 * Never throws and never blocks the caller on the network. A crash reporter that can
 * fail the request it is reporting on is worse than no crash reporter.
 */
export async function reportError(
  error: unknown,
  options: ReportErrorOptions = {},
): Promise<CrashReport> {
  const report = buildCrashReport(error, options);

  try {
    logger(report, error);
  } catch {
    // A logger that throws must not take the process with it.
  }

  const currentSink = sink;
  const consent = await currentCrashReportConsent();

  if (currentSink) {
    // Recorded whatever the answer is, so someone who has not decided yet, or who said
    // no, can still read exactly what would have gone out before they choose.
    try {
      await recordLastCrashReport(report);
    } catch {
      // Inspectability is a convenience; it must not turn one crash into two.
    }
  }

  if (consent === "granted") {
    if (currentSink) {
      void Promise.resolve()
        .then(() => currentSink(report))
        .catch(() => {
          // Delivery is best effort. Losing a report is acceptable; losing the process is not.
        });
    }
  } else if (consent === "unset" && currentSink) {
    // Held, not sent. The user has not been asked yet, and the first crash is usually the
    // one worth having once they say yes. Requires a sink: with nowhere to deliver, a
    // pending file is a queue that can never drain.
    try {
      await appendPendingCrashReport(report);
    } catch {
      // A full or read-only config dir must not turn one crash into two.
    }
  }

  return report;
}

/**
 * Sends what was held back while the install was waiting to be asked. Called once the
 * answer comes back as yes.
 */
export async function flushPendingCrashReports(): Promise<number> {
  const currentSink = sink;

  if (!currentSink || !(await isCrashReportingAllowed())) {
    return 0;
  }

  const pending = await readPendingCrashReports();

  if (pending.length === 0) {
    return 0;
  }

  for (const report of pending) {
    try {
      await currentSink(report);
    } catch {
      // Best effort, same as live delivery.
    }
  }

  await clearPendingCrashReports();
  return pending.length;
}

export async function reportInvariant(
  message: string,
  options: Omit<ReportErrorOptions, "kind"> = {},
): Promise<CrashReport> {
  return reportError(new Error(message), { ...options, kind: "invariant" });
}

const installedSources = new Set<string>();

/**
 * Uses uncaughtExceptionMonitor rather than uncaughtException: the monitor observes the
 * error and leaves Bun's own crash-and-exit behaviour intact. Listening to
 * uncaughtException would swallow the crash and leave a half-dead process behind.
 *
 * unhandledRejection has no monitor variant, and merely listening suppresses Bun's
 * default exit(1), so the exit is re-applied by hand below.
 */
export function installCrashHandlers(source: string): () => void {
  if (installedSources.has(source)) {
    return () => {};
  }

  installedSources.add(source);

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
    installedSources.delete(source);
  };
}
