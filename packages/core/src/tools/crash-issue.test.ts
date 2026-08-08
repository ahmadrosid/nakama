import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countIssuesFiledSince,
  crashIssueTool,
  getFiledCrashIssuesPath,
  neutralizeMentions,
  readFiledCrashIssues,
} from "./crash-issue";

const FINGERPRINT = "a1b2c3d4e5f60718";
const OTHER_FINGERPRINT = "0f1e2d3c4b5a6978";

let configDir = "";
let previousConfigDir: string | undefined;
let originalFetch: typeof fetch;
let calls: Array<{ url: string; method: string; body: any }> = [];
let searchItems: Array<{ html_url: string; number: number }> = [];

function stubFetch(): void {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = init.method ?? "GET";
    calls.push({ body: init.body ? JSON.parse(init.body) : null, method, url });

    if (url.includes("/search/issues")) {
      return new Response(JSON.stringify({ items: searchItems }), {
        status: 200,
      });
    }

    return new Response(
      JSON.stringify({
        html_url: "https://github.com/o/n/issues/7",
        number: 7,
      }),
      { status: 201 }
    );
  }) as typeof fetch;
}

beforeEach(async () => {
  previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  configDir = await mkdtemp(join(tmpdir(), "nakama-crash-issue-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  process.env.NAKAMA_CRASH_ISSUE_REPO = "o/n";
  process.env.NAKAMA_CRASH_ISSUE_TOKEN = "gh-token";
  calls = [];
  searchItems = [];
  originalFetch = globalThis.fetch;
  stubFetch();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;

  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }

  delete process.env.NAKAMA_CRASH_ISSUE_REPO;
  delete process.env.NAKAMA_CRASH_ISSUE_TOKEN;
  await rm(configDir, { force: true, recursive: true });
});

function postCalls() {
  return calls.filter((call) => call.method === "POST");
}

test("the tool refuses to run when no repository is configured", async () => {
  delete process.env.NAKAMA_CRASH_ISSUE_REPO;

  await expect(
    crashIssueTool.run({ action: "find", fingerprint: FINGERPRINT }, {} as any)
  ).rejects.toThrow(/no repository configured/);
});

test("an unrecognised fingerprint is rejected before any request goes out", async () => {
  await expect(
    crashIssueTool.run(
      { action: "find", fingerprint: "../../etc/passwd" },
      {} as any
    )
  ).rejects.toThrow(/invalid parameter/);

  expect(calls).toHaveLength(0);
});

test("find reports nothing when the crash has never been filed", async () => {
  const result = await crashIssueTool.run(
    { action: "find", fingerprint: FINGERPRINT },
    {} as any
  );

  expect(result.found).toBe(false);
  expect(postCalls()).toHaveLength(0);
});

test("filing a new crash creates one issue and records it", async () => {
  const result = await crashIssueTool.run(
    {
      action: "file",
      fingerprint: FINGERPRINT,
      summary: "The loop hits max iterations and returns nothing.",
      title: "Tool loop never terminates",
    },
    {} as any
  );

  expect(result.created).toBe(true);
  expect(result.url).toBe("https://github.com/o/n/issues/7");
  expect(postCalls()).toHaveLength(1);
  expect((await readFiledCrashIssues())[FINGERPRINT]?.number).toBe(7);
});

test("filing the same crash twice never opens a second issue", async () => {
  const input = {
    action: "file" as const,
    fingerprint: FINGERPRINT,
    summary: "The loop hits max iterations and returns nothing.",
    title: "Tool loop never terminates",
  };

  await crashIssueTool.run(input, {} as any);
  const second = await crashIssueTool.run(input, {} as any);

  expect(second.created).toBe(false);
  expect(second.url).toBe("https://github.com/o/n/issues/7");
  expect(second.reason).toBe("already filed");
  expect(postCalls()).toHaveLength(1);
});

test("an issue filed from another machine is found instead of duplicated", async () => {
  searchItems = [{ html_url: "https://github.com/o/n/issues/3", number: 3 }];

  const result = await crashIssueTool.run(
    {
      action: "file",
      fingerprint: FINGERPRINT,
      summary: "Filed elsewhere.",
      title: "Already known",
    },
    {} as any
  );

  expect(result.created).toBe(false);
  expect(result.number).toBe(3);
  expect(postCalls()).toHaveLength(0);
});

test("the hourly cap stops a fingerprint storm and says so", async () => {
  await Bun.write(
    getFiledCrashIssuesPath(),
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 5 }, (_unused, index) => [
          `cafe${index}babe1234`,
          {
            at: Date.now(),
            number: index,
            url: `https://github.com/o/n/issues/${index}`,
          },
        ])
      )
    )
  );

  const result = await crashIssueTool.run(
    {
      action: "file",
      fingerprint: OTHER_FINGERPRINT,
      summary: "Should not be filed.",
      title: "One more",
    },
    {} as any
  );

  expect(result.created).toBe(false);
  expect(result.reason).toContain("hourly cap reached");
  expect(postCalls()).toHaveLength(0);
});

test("issues filed more than an hour ago do not count against the cap", () => {
  const store = {
    a: { at: Date.now() - 2 * 60 * 60 * 1000, number: 1, url: "u" },
    b: { at: Date.now(), number: 2, url: "u" },
  };

  expect(countIssuesFiledSince(store, Date.now() - 60 * 60 * 1000)).toBe(1);
});

test("mentions cannot turn an injected report into a mass ping", async () => {
  await crashIssueTool.run(
    {
      action: "file",
      fingerprint: FINGERPRINT,
      summary: "Ping @maintainer and @octocat about this.",
      title: "Crash reported by @everyone",
    },
    {} as any
  );

  const created = postCalls()[0]?.body;

  expect(created.title).not.toMatch(/(^|[^`])@everyone/);
  expect(created.body).not.toMatch(/(^|[^`])@maintainer/);
  expect(created.body).toContain("`@octocat`");
});

test("neutralizeMentions leaves ordinary text alone", () => {
  expect(neutralizeMentions("failed at line 12, no mentions here")).toBe(
    "failed at line 12, no mentions here"
  );
});

test("the filed issue carries the fingerprint marker so it can be found again", async () => {
  await crashIssueTool.run(
    {
      action: "file",
      fingerprint: FINGERPRINT,
      summary: "Body text.",
      title: "Marker check",
    },
    {} as any
  );

  expect(postCalls()[0]?.body.body).toContain(
    `nakama-crash-fingerprint: ${FINGERPRINT}`
  );
});
