import { afterEach, beforeEach, expect, test } from "bun:test";
import { hostname } from "node:os";
import {
  buildCrashReport,
  type CrashReport,
  createCrashReportSink,
  parseSentryDsn,
  resetCrashReportConsentCache,
  sendSentryEvent,
  toSentryEvent,
} from "./crash-report";

let previousDsn: string | undefined;

beforeEach(() => {
  previousDsn = process.env.NAKAMA_CRASH_REPORT_DSN;
  resetCrashReportConsentCache();
});

afterEach(() => {
  if (previousDsn === undefined) {
    delete process.env.NAKAMA_CRASH_REPORT_DSN;
  } else {
    process.env.NAKAMA_CRASH_REPORT_DSN = previousDsn;
  }

  resetCrashReportConsentCache();
});

function sampleReport(): CrashReport {
  return buildCrashReport(new Error("tool loop exceeded"), {
    source: "server",
  });
}

test("parseSentryDsn builds the store endpoint and key", () => {
  expect(parseSentryDsn("https://abc123@errors.example.com/7")).toEqual({
    endpoint: "https://errors.example.com/api/7/store/",
    publicKey: "abc123",
  });
});

test("parseSentryDsn keeps a path prefix for a subpath install", () => {
  expect(parseSentryDsn("https://k@example.com/glitchtip/12")?.endpoint).toBe(
    "https://example.com/glitchtip/api/12/store/"
  );
});

test("parseSentryDsn rejects garbage rather than throwing", () => {
  expect(parseSentryDsn("")).toBeNull();
  expect(parseSentryDsn("not a url")).toBeNull();
  expect(parseSentryDsn("https://example.com/7")).toBeNull();
});

test("the event forces our own fingerprint so grouping survives across installs", () => {
  const report = sampleReport();
  const event = toSentryEvent(report, { installId: "install-1" });

  expect(event.fingerprint).toEqual([report.fingerprint]);
});

test("the install id is the only user identity sent", () => {
  const event = toSentryEvent(sampleReport(), { installId: "install-1" });

  expect(event.user).toEqual({ id: "install-1" });
});

test("the event never carries the hostname", () => {
  const event = toSentryEvent(sampleReport(), { installId: "install-1" });

  expect(event).not.toHaveProperty("server_name");
  expect(JSON.stringify(event)).not.toContain(hostname());
});

test("an invariant is sent at a lower level than a crash", () => {
  const crash = toSentryEvent(
    buildCrashReport(new Error("x"), { kind: "crash" })
  );
  const invariant = toSentryEvent(
    buildCrashReport(new Error("x"), { kind: "invariant" })
  );

  expect(crash.level).toBe("error");
  expect(invariant.level).toBe("warning");
});

test("sendSentryEvent posts the event with the auth header the ingest expects", async () => {
  let received: { auth: string | null; body: any; method: string } | null =
    null;

  const server = Bun.serve({
    async fetch(request) {
      received = {
        auth: request.headers.get("x-sentry-auth"),
        body: await request.json(),
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
    const ok = await sendSentryEvent(dsn!, toSentryEvent(sampleReport()));

    expect(ok).toBe(true);
    expect(dsn?.endpoint).toBe(
      `http://${server.hostname}:${server.port}/api/42/store/`
    );
    expect(received!.method).toBe("POST");
    expect(received!.auth).toContain("sentry_version=7");
    expect(received!.auth).toContain("sentry_key=pubkey");
    expect(received!.body.exception.values[0].value).toBe("tool loop exceeded");
  } finally {
    server.stop(true);
  }
});

test("sendSentryEvent reports failure instead of throwing when the ingest is down", async () => {
  const dsn = parseSentryDsn("http://k@127.0.0.1:1/9");

  expect(await sendSentryEvent(dsn!, {}, 200)).toBe(false);
});

test("the sink fails when no DSN is configured", async () => {
  process.env.NAKAMA_CRASH_REPORT_DSN = "";
  resetCrashReportConsentCache();

  await expect(createCrashReportSink()(sampleReport())).rejects.toThrow(
    /DSN is not configured/
  );
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
    process.env.NAKAMA_CRASH_REPORT_DSN = `http://k@${server.hostname}:${server.port}/1`;
    resetCrashReportConsentCache();

    await createCrashReportSink()(sampleReport());

    expect(hits).toBe(1);
  } finally {
    server.stop(true);
  }
});
