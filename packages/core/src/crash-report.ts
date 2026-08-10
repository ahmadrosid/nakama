import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { NAKAMA_API_VERSION } from "./contract";

export type CrashReportKind = "crash" | "invariant";
export type CrashLogger = (report: CrashReport, error: unknown) => void;

export const MAX_BREADCRUMBS = 50;

export type Breadcrumb = { at: number; kind: string };
export type CrashContext = {
  breadcrumbs: Breadcrumb[];
  orgIdHash?: string;
  requestId: string;
  route?: string;
  sessionIdHash?: string;
  source: string;
  userIdHash?: string;
};
export type CrashReport = {
  at: string;
  breadcrumbs: Breadcrumb[];
  fingerprint: string;
  kind: CrashReportKind;
  message: string;
  name: string;
  orgIdHash?: string;
  requestId?: string;
  route?: string;
  runtime: { apiVersion: number; bun: string; platform: string; arch: string };
  sessionIdHash?: string;
  source: string;
  stack?: string;
  userIdHash?: string;
};
export type ReportErrorOptions = {
  context?: CrashContext;
  kind?: CrashReportKind;
  source?: string;
};

const storage = new AsyncLocalStorage<CrashContext>();
const installedSources = new Set<string>();
const MAX_TEXT_LENGTH = 4000;
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi, "Bearer <redacted>"],
  [
    /\b((?:Proxy-)?Authorization:\s*Basic\s+)[A-Za-z0-9+/=_-]+/gi,
    "$1<redacted>",
  ],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "<redacted-key>"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "<redacted-key>"],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, "<redacted-key>"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "<redacted-key>"],
  [
    /hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi,
    "hooks.slack.com/services/<redacted>",
  ],
  [
    /([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/g,
    "$1<redacted>:<redacted>@",
  ],
  [
    /([A-Za-z0-9_]*(?:api[_-]?key|apikey|token|secret|passwd|password|authorization|credential))(["']?\s*[:=]\s*["']?)([^\s"',;)}]{3,})/gi,
    "$1$2<redacted>",
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "<redacted-token>"],
];

let logger: CrashLogger = defaultLogger;

export function hashId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed
    ? createHash("sha256").update(trimmed).digest("hex").slice(0, 12)
    : undefined;
}

/**
 * Allowlisting what may leave would mean knowing every shape an error message can
 * take, so this denies instead: anything quoted, bracketed or braced is a payload
 * until proven otherwise. It over-redacts, which is the side to be wrong on.
 */
export function scrubText(value: string): string {
  if (!value) {
    return "";
  }

  let out = value;
  const home = homedir();

  if (home && home !== "/") {
    out = out.split(home).join("~");
  }

  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }

  out = out
    .replace(/\/(?:Users|home)\/[^/\s:"']+/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s:"']+/g, "~")
    .replace(/"[^"\n]*"/g, '"<redacted>"');

  // Nested structures need more than one pass, but a hostile payload should not
  // decide how many. Four collapses anything realistic.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = out
      .replace(/\{[^{}]*\}/g, "<redacted>")
      .replace(/\[[^[\]]*\]/g, "<redacted>");

    if (next === out) {
      break;
    }

    out = next;
  }

  return out.length > MAX_TEXT_LENGTH
    ? `${out.slice(0, MAX_TEXT_LENGTH)}…`
    : out;
}

export function createCrashContext(seed: {
  source: string;
  requestId?: string;
  route?: string;
}): CrashContext {
  return {
    breadcrumbs: [],
    requestId: seed.requestId?.trim() || randomUUID(),
    source: seed.source,
    ...(seed.route ? { route: seed.route } : {}),
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
 * Kind only. A breadcrumb carrying data would be the one place user content enters a
 * report without passing the scrubber.
 */
export function breadcrumb(kind: string): void {
  const context = storage.getStore();

  if (!context) {
    return;
  }

  context.breadcrumbs.push({ at: Date.now(), kind });

  if (context.breadcrumbs.length > MAX_BREADCRUMBS) {
    context.breadcrumbs.shift();
  }
}

/**
 * Normalizes ids, uuids, quoted strings and numbers out of the message so one bug
 * stays one fingerprint across installs and releases.
 */
export function fingerprintError(
  name: string,
  message: string,
  stack: string | undefined
): string {
  const normalized = message
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<uuid>"
    )
    .replace(
      /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{8,}\b/g,
      "<id>"
    )
    .replace(/'[^']*'|"[^"]*"/g, "<str>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();

  let frame = "";

  if (stack) {
    for (const line of stack.split("\n").slice(1)) {
      const trimmed = line.trim();

      if (
        trimmed.startsWith("at ") &&
        !trimmed.includes("node_modules") &&
        !trimmed.includes("node:")
      ) {
        frame = trimmed.replace(/:\d+:\d+(\)?)$/, "$1").replace(/\s+/g, " ");
        break;
      }
    }
  }

  return createHash("sha256")
    .update([name, normalized, frame].join("|"))
    .digest("hex")
    .slice(0, 16);
}

export function buildCrashReport(
  error: unknown,
  options: ReportErrorOptions = {}
): CrashReport {
  const context = options.context ?? storage.getStore();
  let name = "NonError";
  let message: string;
  let stack: string | undefined;

  if (error instanceof Error) {
    name = error.name || "Error";
    message = error.message || String(error);
    stack = error.stack;
  } else if (typeof error === "string") {
    message = error;
  } else {
    try {
      message = JSON.stringify(error) ?? String(error);
    } catch {
      message = String(error);
    }
  }

  const scrubbedStack = stack ? scrubText(stack) : undefined;

  // Fingerprinted before scrubbing, so redaction cannot merge two distinct bugs.
  return {
    at: new Date().toISOString(),
    breadcrumbs: context?.breadcrumbs ? [...context.breadcrumbs] : [],
    fingerprint: fingerprintError(name, message, stack),
    kind: options.kind ?? "crash",
    message: scrubText(message),
    name,
    runtime: {
      apiVersion: NAKAMA_API_VERSION,
      arch: process.arch,
      bun: Bun.version,
      platform: process.platform,
    },
    source: options.source ?? context?.source ?? "unknown",
    ...(scrubbedStack ? { stack: scrubbedStack } : {}),
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.route ? { route: context.route } : {}),
    ...(context?.orgIdHash ? { orgIdHash: context.orgIdHash } : {}),
    ...(context?.userIdHash ? { userIdHash: context.userIdHash } : {}),
    ...(context?.sessionIdHash ? { sessionIdHash: context.sessionIdHash } : {}),
  };
}

function defaultLogger(report: CrashReport, error: unknown): void {
  console.error(
    `[nakama:${report.kind}] ${report.source} ${report.fingerprint}` +
      `${report.requestId ? ` req=${report.requestId}` : ""}` +
      `${report.route ? ` route=${report.route}` : ""}`,
    error
  );
}

export function setCrashLogger(next: CrashLogger | null): void {
  logger = next ?? defaultLogger;
}

/**
 * The one entry point. Always logs locally and in full; the scrubbed report is what a
 * later change may ship somewhere else.
 */
export async function reportError(
  error: unknown,
  options: ReportErrorOptions = {}
): Promise<CrashReport> {
  const report = buildCrashReport(error, options);

  try {
    logger(report, error);
  } catch {
    // A broken logger must not take the process down on top of the original error.
  }

  return report;
}

/**
 * For failures that never throw: a worker that did not start, a run that never
 * finished. Users notice these and never report them.
 */
export async function reportInvariant(
  message: string,
  options: Omit<ReportErrorOptions, "kind"> = {}
): Promise<CrashReport> {
  return reportError(new Error(message), { ...options, kind: "invariant" });
}

export function installCrashHandlers(source: string): () => void {
  if (installedSources.has(source)) {
    return () => {};
  }

  installedSources.add(source);

  const onCrash = (error: unknown) => {
    void reportError(error, { source }).finally(() => {
      process.exit(1);
    });
  };

  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);

  return () => {
    process.off("uncaughtException", onCrash);
    process.off("unhandledRejection", onCrash);
    installedSources.delete(source);
  };
}
