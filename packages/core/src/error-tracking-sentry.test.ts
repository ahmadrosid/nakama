import { afterEach, beforeEach, expect, test } from "bun:test";
import { hostname } from "node:os";
import { buildErrorReport, type ErrorReport } from "./error-tracking";
import {
  createErrorTrackingSink,
  parseSentryDsn,
  sendSentryEvent,
  toSentryEvent,
} from "./error-tracking-sentry";

let previousDsn: string | undefined;

beforeEach(() => {
  previousDsn = process.env.NAKAMA_ERROR_TRACKING_DSN;
});

afterEach(() => {
  if (previousDsn === undefined) {
    delete process.env.NAKAMA_ERROR_TRACKING_DSN;
  } else {
    process.env.NAKAMA_ERROR_TRACKING_DSN = previousDsn;
  }
});

function sampleReport(): ErrorReport {
  return buildErrorReport(new Error("tool loop exceeded"), {
    source: "server",
  });
}

test("parseSentryDsn builds the envelope endpoint and key", () => {
  expect(parseSentryDsn("https://abc123@errors.example.com/7")).toEqual({
    endpoint: "https://errors.example.com/api/7/envelope/",
    publicKey: "abc123",
  });
});

test("parseSentryDsn keeps a path prefix for a subpath install", () => {
  expect(parseSentryDsn("https://k@example.com/glitchtip/12")?.endpoint).toBe(
    "https://example.com/glitchtip/api/12/envelope/"
  );
});

test("parseSentryDsn rejects garbage rather than throwing", () => {
  expect(parseSentryDsn("")).toBeNull();
  expect(parseSentryDsn("not a url")).toBeNull();
  expect(parseSentryDsn("https://example.com/7")).toBeNull();
});

test("the event forces our own fingerprint so grouping survives across installs", () => {
  const report = sampleReport();
  const event = toSentryEvent(report);

  expect(event.fingerprint).toEqual([report.fingerprint]);
});

test("no user identity is sent", () => {
  const event = toSentryEvent(sampleReport());

  // Reports go to the operator's own project, so there is nobody to count installs
  // for and nothing that needs a stable id attached to the event.
  expect(event).not.toHaveProperty("user");
});

test("the event id is the report id, so a retry collapses into one event", () => {
  const report = sampleReport();
  const first = toSentryEvent(report);
  const second = toSentryEvent(report);

  expect(first.event_id).toBe(report.id.replace(/-/g, ""));
  expect(second.event_id).toBe(first.event_id);
});

test("the event never carries the hostname", () => {
  const event = toSentryEvent(sampleReport());

  expect(event).not.toHaveProperty("server_name");
  expect(JSON.stringify(event)).not.toContain(hostname());
});

test("a test event is sent at a lower level than a crash", () => {
  const crash = toSentryEvent(
    buildErrorReport(new Error("x"), { kind: "crash" })
  );
  const testEvent = toSentryEvent(
    buildErrorReport(new Error("x"), { kind: "test" })
  );

  expect(crash.level).toBe("error");
  expect(testEvent.level).toBe("info");
});

test("sendSentryEvent posts an envelope with the auth header the ingest expects", async () => {
  let received: {
    auth: string | null;
    body: string;
    contentType: string | null;
    method: string;
  } | null = null;

  const server = Bun.serve({
    async fetch(request) {
      received = {
        auth: request.headers.get("x-sentry-auth"),
        body: await request.text(),
        contentType: request.headers.get("content-type"),
        method: request.method,
      };
      return new Response("{}", { status: 200 });
    },
    port: 0,
  });

  try {
    const dsn = parseSentryDsn(
      `http://pubkey@${server.hostname}:${server.port}/42`
    );
    const event = toSentryEvent(sampleReport());
    const ok = await sendSentryEvent(dsn!, event);

    expect(ok).toBe(true);
    expect(dsn?.endpoint).toBe(
      `http://${server.hostname}:${server.port}/api/42/envelope/`
    );
    expect(received!.method).toBe("POST");
    expect(received!.contentType).toBe("application/x-sentry-envelope");
    expect(received!.auth).toContain("sentry_version=7");
    expect(received!.auth).toContain("sentry_key=pubkey");

    // The envelope is the header line, the item header line, then the payload.
    const [envelopeHeader, itemHeader, payload] = received!.body.split("\n");

    expect(JSON.parse(envelopeHeader).event_id).toBe(event.event_id);
    expect(JSON.parse(itemHeader)).toEqual({
      content_type: "application/json",
      length: Buffer.byteLength(payload),
      type: "event",
    });
    expect(JSON.parse(payload).exception.values[0].value).toBe(
      "tool loop exceeded"
    );
  } finally {
    server.stop(true);
  }
});

test("sendSentryEvent reports failure instead of throwing when the ingest is down", async () => {
  const dsn = parseSentryDsn("http://k@127.0.0.1:1/9");

  expect(await sendSentryEvent(dsn!, toSentryEvent(sampleReport()), 200)).toBe(
    false
  );
});

async function countSinkHits(env: Record<string, string>): Promise<number> {
  let hits = 0;

  const server = Bun.serve({
    fetch() {
      hits += 1;
      return new Response("{}", { status: 200 });
    },
    port: 0,
  });

  try {
    process.env.NAKAMA_ERROR_TRACKING_DSN = `http://k@${server.hostname}:${server.port}/1`;

    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }

    await createErrorTrackingSink()(sampleReport());
    return hits;
  } finally {
    server.stop(true);

    for (const key of Object.keys(env)) {
      delete process.env[key];
    }
  }
}

test("the sink contacts nothing when no DSN is configured", async () => {
  expect(await countSinkHits({ NAKAMA_ERROR_TRACKING_DSN: "" })).toBe(0);
});

test("the sink contacts nothing under DO_NOT_TRACK", async () => {
  expect(await countSinkHits({ DO_NOT_TRACK: "1" })).toBe(0);
});

test("the sink delivers to the configured DSN", async () => {
  let hits = 0;

  const server = Bun.serve({
    fetch() {
      hits += 1;
      return new Response("{}", { status: 200 });
    },
    port: 0,
  });

  try {
    process.env.NAKAMA_ERROR_TRACKING_DSN = `http://k@${server.hostname}:${server.port}/1`;

    await createErrorTrackingSink()(sampleReport());

    expect(hits).toBe(1);
  } finally {
    server.stop(true);
  }
});
