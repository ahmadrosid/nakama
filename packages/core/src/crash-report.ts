import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { NAKAMA_API_VERSION } from "./contract";
import { parseIni, readTextOrNull, writePrivateTextFile } from "./fs";
import { getUserConfigDir } from "./user-config";

export type CrashReportKind = "crash" | "invariant";
export type CrashReportConsent = "granted" | "denied" | "unset";
export type CrashSink = (report: CrashReport) => void | Promise<void>;
export type CrashLogger = (report: CrashReport, error: unknown) => void;

export const MAX_BREADCRUMBS = 50;
export const MAX_PENDING_CRASH_REPORTS = 3;
export const DEFAULT_CRASH_REPORT_DSN =
  "https://a9d0037386bb48ff984bc7909712e298@app.glitchtip.com/26619";

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
export type CrashReportConfig = {
  consent: CrashReportConsent;
  dsn: string | null;
  installId: string | null;
};
export type ReportErrorOptions = {
  context?: CrashContext;
  kind?: CrashReportKind;
  source?: string;
};
export type SentryDsn = { endpoint: string; publicKey: string };

const storage = new AsyncLocalStorage<CrashContext>();
const installedSources = new Set<string>();
const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSY = new Set(["0", "false", "off", "no"]);
const MAX_TEXT_LENGTH = 4000;
const SEND_TIMEOUT_MS = 3000;
const SENTRY_CLIENT = "nakama/1";
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
let sink: CrashSink | null = null;
let cachedConfig: Promise<CrashReportConfig> | null = null;

const configFile = () => join(getUserConfigDir(), "crash-reports.ini");
const pendingFile = () =>
  join(getUserConfigDir(), "crash-reports-pending.json");
const lastFile = () => join(getUserConfigDir(), "crash-report-last.json");
export const getCrashReportConfigPath = configFile;
export const getPendingCrashReportsPath = pendingFile;
export const getLastCrashReportPath = lastFile;

async function writeJson(path: string, value: unknown): Promise<void> {
  await writePrivateTextFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    ensureDir: getUserConfigDir(),
  });
}

async function readJson<T>(
  path: string,
  fallback: T,
  guard: (v: unknown) => v is T
): Promise<T> {
  const raw = await readTextOrNull(path);
  if (raw === null) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function hashId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed
    ? createHash("sha256").update(trimmed).digest("hex").slice(0, 12)
    : undefined;
}

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

export function readCrashReportEnvOverride(
  env: Record<string, string | undefined> = process.env
): CrashReportConsent | null {
  if (TRUTHY.has(env.DO_NOT_TRACK?.trim().toLowerCase() ?? "")) {
    return "denied";
  }
  const raw = env.NAKAMA_CRASH_REPORTS?.trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if (TRUTHY.has(raw)) {
    return "granted";
  }
  if (FALSY.has(raw)) {
    return "denied";
  }
  return null;
}

export async function loadCrashReportConfig(): Promise<CrashReportConfig> {
  const raw = await readTextOrNull(configFile());
  if (raw === null) {
    return { consent: "unset", dsn: null, installId: null };
  }
  const values = parseIni(raw);
  const consent = values.consent?.trim().toLowerCase();
  return {
    consent: consent === "granted" || consent === "denied" ? consent : "unset",
    dsn: values.dsn?.trim() || null,
    installId: values.install_id?.trim() || null,
  };
}

export function resolveCrashReportConsent(
  file: CrashReportConfig,
  env: Record<string, string | undefined> = process.env
): CrashReportConsent {
  return readCrashReportEnvOverride(env) ?? file.consent;
}

export function resolveCrashReportDsn(
  file: CrashReportConfig,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (env.NAKAMA_CRASH_REPORT_DSN !== undefined) {
    return env.NAKAMA_CRASH_REPORT_DSN.trim() || null;
  }
  return file.dsn || DEFAULT_CRASH_REPORT_DSN || null;
}

export function resetCrashReportConsentCache(): void {
  cachedConfig = null;
}

export async function loadCachedCrashReportConfig(): Promise<CrashReportConfig> {
  cachedConfig ??= loadCrashReportConfig();
  return cachedConfig;
}

export async function saveCrashReportConsent(
  consent: Exclude<CrashReportConsent, "unset">
): Promise<CrashReportConfig> {
  const existing = await loadCrashReportConfig();
  const next: CrashReportConfig = {
    consent,
    dsn: existing.dsn,
    installId:
      consent === "granted" ? (existing.installId ?? randomUUID()) : null,
  };
  await writePrivateTextFile(
    configFile(),
    [
      "# Nakama crash reports",
      `consent=${next.consent}`,
      ...(next.installId ? [`install_id=${next.installId}`] : []),
      ...(next.dsn ? [`dsn=${next.dsn}`] : []),
      "",
    ].join("\n"),
    { ensureDir: getUserConfigDir() }
  );
  resetCrashReportConsentCache();
  return next;
}

export async function currentCrashReportConsent(): Promise<CrashReportConsent> {
  try {
    return resolveCrashReportConsent(await loadCachedCrashReportConfig());
  } catch {
    return "denied";
  }
}

export async function isCrashReportingAllowed(): Promise<boolean> {
  return (await currentCrashReportConsent()) === "granted";
}

export async function readPendingCrashReports(): Promise<CrashReport[]> {
  const entries = await readJson(pendingFile(), [], Array.isArray);
  return entries.filter(isCrashReport).map(scrubStoredCrashReport);
}

export async function appendPendingCrashReport(
  report: CrashReport
): Promise<void> {
  const existing = await readPendingCrashReports();
  if (existing.some((entry) => entry.fingerprint === report.fingerprint)) {
    return;
  }
  await writeJson(
    pendingFile(),
    [...existing, report].slice(-MAX_PENDING_CRASH_REPORTS)
  );
}

export async function clearPendingCrashReports(): Promise<void> {
  await writeJson(pendingFile(), []);
}

export async function recordLastCrashReport(
  report: CrashReport
): Promise<void> {
  await writeJson(lastFile(), report);
}

export async function readLastCrashReport(): Promise<CrashReport | null> {
  const report = await readJson(lastFile(), null, (v): v is CrashReport =>
    isCrashReport(v)
  );
  return report ? scrubStoredCrashReport(report) : null;
}

function isCrashReport(value: unknown): value is CrashReport {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const report = value as Record<string, unknown>;
  return (
    typeof report.fingerprint === "string" &&
    typeof report.message === "string" &&
    typeof report.name === "string" &&
    typeof report.at === "string" &&
    typeof report.source === "string" &&
    (report.kind === "crash" || report.kind === "invariant") &&
    Array.isArray(report.breadcrumbs)
  );
}

function scrubStoredCrashReport(report: CrashReport): CrashReport {
  return {
    ...report,
    message: scrubText(report.message),
    ...(report.stack ? { stack: scrubText(report.stack) } : {}),
  };
}

export function parseSentryDsn(dsn: string): SentryDsn | null {
  try {
    const url = new URL(dsn.trim());
    const publicKey = url.username;
    const segments = url.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (!(publicKey && projectId)) {
      return null;
    }
    const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
    return {
      endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/store/`,
      publicKey,
    };
  } catch {
    return null;
  }
}

export function toSentryEvent(
  report: CrashReport,
  options: { installId: string | null } = { installId: null }
): Record<string, unknown> {
  return {
    event_id: randomUUID().replace(/-/g, ""),
    exception: { values: [{ type: report.name, value: report.message }] },
    fingerprint: [report.fingerprint],
    level: report.kind === "invariant" ? "warning" : "error",
    logger: "nakama",
    platform: "node",
    timestamp: report.at,
    ...(options.installId ? { user: { id: options.installId } } : {}),
    tags: {
      kind: report.kind,
      os: report.runtime.platform,
      source: report.source,
    },
    ...(report.stack ? { extra: { stack: report.stack } } : {}),
  };
}

export async function sendSentryEvent(
  dsn: SentryDsn,
  event: Record<string, unknown>,
  timeoutMs = SEND_TIMEOUT_MS
): Promise<boolean> {
  try {
    const response = await fetch(dsn.endpoint, {
      body: JSON.stringify(event),
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=${SENTRY_CLIENT}, sentry_key=${dsn.publicKey}`,
      },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function createCrashReportSink(): CrashSink {
  return async (report) => {
    const config = await loadCachedCrashReportConfig();
    const dsn = parseSentryDsn(resolveCrashReportDsn(config) ?? "");
    if (!dsn) {
      throw new Error("crash report DSN is not configured");
    }
    const ok = await sendSentryEvent(
      dsn,
      toSentryEvent(report, { installId: config.installId })
    );
    if (!ok) {
      throw new Error("crash report delivery failed");
    }
  };
}

export function installCrashReportSink(): void {
  setCrashSink(createCrashReportSink());
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

export function setCrashSink(next: CrashSink | null): void {
  sink = next;
}

export async function reportError(
  error: unknown,
  options: ReportErrorOptions = {}
): Promise<CrashReport> {
  const report = buildCrashReport(error, options);
  try {
    logger(report, error);
  } catch {
    // ignore
  }
  const currentSink = sink;
  if (currentSink) {
    try {
      await recordLastCrashReport(report);
    } catch {
      // ignore
    }
  }
  const consent = await currentCrashReportConsent();
  if (consent === "granted" && currentSink) {
    void Promise.resolve()
      .then(() => currentSink(report))
      .catch(() => {});
  } else if (consent === "unset" && currentSink) {
    try {
      await appendPendingCrashReport(report);
    } catch {
      // ignore
    }
  }
  return report;
}

export async function flushPendingCrashReports(): Promise<number> {
  const currentSink = sink;
  if (!(currentSink && (await isCrashReportingAllowed()))) {
    return 0;
  }
  const pending = await readPendingCrashReports();
  if (pending.length === 0) {
    return 0;
  }
  const remaining: CrashReport[] = [];
  let sent = 0;
  for (const report of pending) {
    try {
      await currentSink(report);
      sent += 1;
    } catch {
      remaining.push(report);
    }
  }
  await writeJson(pendingFile(), remaining);
  return sent;
}

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
  const onUncaught = (error: unknown) => {
    void reportError(error, { source }).finally(() => {
      process.exit(1);
    });
  };
  const onRejection = (reason: unknown) => {
    void reportError(reason, { source }).finally(() => {
      process.exit(1);
    });
  };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onRejection);
  return () => {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onRejection);
    installedSources.delete(source);
  };
}
