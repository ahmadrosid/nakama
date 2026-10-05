import {
  type ErrorReport,
  type ErrorSink,
  refreshErrorTrackingEnabled,
  setErrorSink,
} from "./error-tracking";
import {
  loadErrorTrackingConfig,
  resolveErrorTrackingDsn,
} from "./error-tracking-config";

const SEND_TIMEOUT_MS = 3000;
const SENTRY_CLIENT = "nakama/1";

export interface SentryDsn {
  endpoint: string;
  publicKey: string;
}

/**
 * The slice of the Sentry event payload nakama actually sends. Hand-rolled because no
 * SDK is in use, and named so the payload is a checked shape rather than a bag: a
 * typo in a key here is silently ignored by the ingest and impossible to spot later.
 */
export interface SentryEvent {
  contexts: {
    os: { name: string };
    runtime: { name: string; version: string };
  };
  event_id: string;
  exception: { values: { type: string; value: string }[] };
  extra?: { stack: string };
  fingerprint: string[];
  level: "error" | "info";
  logger: string;
  platform: string;
  tags: {
    api_version: string;
    arch: string;
    bun: string;
    kind: string;
    os: string;
    source: string;
  };
  timestamp: string;
}

/**
 * One protocol covers Sentry, GlitchTip, Bugsink, Rustrak and self-hosted Sentry: they
 * all accept the same envelope endpoint and X-Sentry-Auth header, so the operator picks
 * the platform and nakama does not have to know which one it is talking to.
 *
 * The envelope endpoint, not the older store one. Store is deprecated in Sentry and
 * removed outright in Rustrak, which answers 400 to it, so an envelope is the one shape
 * every ingest still takes.
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

  if (!(publicKey && projectId)) {
    return null;
  }

  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";

  return {
    endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
    publicKey,
  };
}

export function toSentryEvent(report: ErrorReport): SentryEvent {
  return {
    contexts: {
      os: { name: report.runtime.platform },
      runtime: { name: "bun", version: report.runtime.bun },
    },
    // The report's own id, so the queued copy and the live send land as one event.
    event_id: report.id.replace(/-/g, ""),
    exception: {
      values: [{ type: report.name, value: report.message }],
    },
    ...(report.stack ? { extra: { stack: report.stack } } : {}),
    // Grouping is ours rather than the ingest's, so one bug stays one issue even when
    // stack frames differ between installs.
    fingerprint: [report.fingerprint],
    level: report.kind === "test" ? "info" : "error",
    logger: "nakama",
    platform: "node",
    tags: {
      api_version: String(report.runtime.apiVersion),
      arch: report.runtime.arch,
      bun: report.runtime.bun,
      kind: report.kind,
      os: report.runtime.platform,
      source: report.source,
    },
    timestamp: report.at,
    // server_name is deliberately absent. Sentry defaults it to the hostname, which on
    // a self-hosted install is often the operator's own machine or cluster name.
  };
}

/**
 * The wire form of one event: an envelope, which is the only ingestion shape every
 * Sentry-compatible backend still accepts. Sentry and GlitchTip keep store alive for
 * legacy clients, but it is deprecated and Rustrak rejects it, so the envelope is what
 * makes "Sentry-compatible" true for all of them rather than for three of them.
 *
 * Layout is fixed by the protocol: the envelope header line, then for each item its
 * header line and its payload line, each newline-terminated. The length is in bytes
 * rather than characters, because the event carries stack traces and error messages
 * that are not ASCII in general.
 */
export async function sendSentryEvent(
  dsn: SentryDsn,
  event: SentryEvent,
  timeoutMs = SEND_TIMEOUT_MS
): Promise<boolean> {
  const payload = JSON.stringify(event);
  const envelopeHeader = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
  });
  const itemHeader = JSON.stringify({
    content_type: "application/json",
    length: Buffer.byteLength(payload),
    type: "event",
  });

  try {
    const response = await fetch(dsn.endpoint, {
      body: `${envelopeHeader}\n${itemHeader}\n${payload}\n`,
      headers: {
        "Content-Type": "application/x-sentry-envelope",
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

/**
 * Resolves the DSN per send, so saving one from the Integrations tab starts delivery
 * without a restart and clearing it stops delivery just as fast.
 */
export function createErrorTrackingSink(): ErrorSink {
  return async (report) => {
    const config = await loadErrorTrackingConfig();
    const dsn = parseSentryDsn(resolveErrorTrackingDsn(config) ?? "");

    if (!dsn) {
      return false;
    }

    return await sendSentryEvent(dsn, toSentryEvent(report));
  };
}

/**
 * Refreshes the enabled flag as part of installing, so the sink and the flag can
 * never disagree about whether the integration is on.
 */
export async function installErrorTrackingSink(): Promise<void> {
  setErrorSink(createErrorTrackingSink());
  await refreshErrorTrackingEnabled();
}
