import { randomUUID } from "node:crypto";
import { setCrashSink, type CrashReport, type CrashSink } from "./crash-report";
import { loadCachedCrashReportConfig, resolveCrashReportDsn } from "./crash-report-config";

const SEND_TIMEOUT_MS = 3_000;
const SENTRY_CLIENT = "nakama/1";

export interface SentryDsn {
  endpoint: string;
  publicKey: string;
}

/**
 * Sentry-compatible ingest (Sentry or GlitchTip) rather than a webhook we own: the
 * deduplication, rate limiting and Discord alerting already exist there, and a DSN is
 * built to be public, which a Discord webhook URL in an open repo is not.
 */
export function parseSentryDsn(dsn: string): SentryDsn | null {
  const trimmed = dsn.trim();

  if (!trimmed) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const publicKey = url.username;
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();

  if (!publicKey || !projectId) {
    return null;
  }

  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";

  return {
    endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/store/`,
    publicKey,
  };
}

export function toSentryEvent(
  report: CrashReport,
  options: { installId: string | null } = { installId: null },
): Record<string, unknown> {
  return {
    event_id: randomUUID().replace(/-/g, ""),
    timestamp: report.at,
    platform: "node",
    level: report.kind === "invariant" ? "warning" : "error",
    logger: "nakama",
    // fingerprint is ours, not the ingest's: grouping has to survive stack frames that
    // differ between installs, and it is what PR 3 keys the GitHub issue on.
    fingerprint: [report.fingerprint],
    exception: {
      values: [{ type: report.name, value: report.message }],
    },
    // Sentry counts distinct users per issue, which is the "how many installs hit this"
    // signal the auto-filing threshold needs. It is the random install id, nothing else.
    ...(options.installId ? { user: { id: options.installId } } : {}),
    tags: {
      kind: report.kind,
      source: report.source,
      api_version: String(report.runtime.apiVersion),
      bun: report.runtime.bun,
      os: report.runtime.platform,
      arch: report.runtime.arch,
      ...(report.route ? { route: report.route } : {}),
    },
    contexts: {
      runtime: { name: "bun", version: report.runtime.bun },
      os: { name: report.runtime.platform },
    },
    breadcrumbs: {
      values: report.breadcrumbs.map((entry) => ({
        timestamp: entry.at / 1_000,
        category: entry.kind,
        level: "info",
        ...(entry.data ? { data: entry.data } : {}),
      })),
    },
    extra: {
      ...(report.stack ? { stack: report.stack } : {}),
      ...(report.requestId ? { request_id: report.requestId } : {}),
      ...(report.orgIdHash ? { org: report.orgIdHash } : {}),
      ...(report.userIdHash ? { user_hash: report.userIdHash } : {}),
      ...(report.sessionIdHash ? { session: report.sessionIdHash } : {}),
    },
    // server_name is deliberately absent. Sentry defaults it to the hostname, which on a
    // self-hosted install is often the customer's own machine or cluster name.
  };
}

export async function sendSentryEvent(
  dsn: SentryDsn,
  event: Record<string, unknown>,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const response = await fetch(dsn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=${SENTRY_CLIENT}, sentry_key=${dsn.publicKey}`,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Reads config per send rather than at startup so consent granted mid-session takes
 * effect without a restart. Reports are rare enough that the cached read costs nothing.
 */
export function createCrashReportSink(): CrashSink {
  return async (report) => {
    const config = await loadCachedCrashReportConfig();
    const dsn = parseSentryDsn(resolveCrashReportDsn(config) ?? "");

    if (!dsn) {
      return;
    }

    await sendSentryEvent(dsn, toSentryEvent(report, { installId: config.installId }));
  };
}

export function installCrashReportSink(): void {
  setCrashSink(createCrashReportSink());
}
