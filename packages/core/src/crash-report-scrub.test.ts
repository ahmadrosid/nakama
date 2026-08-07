import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { hashId, scrubBreadcrumbData, scrubText } from "./crash-report-scrub";

/**
 * These assert the negative side: given a payload that carries real secrets, none of
 * them may survive. A crash report leaves the user's machine and carries their org's
 * data, so a regression here is a third-party data incident, not a telemetry bug.
 */
describe("scrubText removes credentials", () => {
  const cases: Array<[string, string]> = [
    ["anthropic key", "failed with sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345"],
    ["openai key", "Authorization header sk-proj-AAAABBBBCCCCDDDDEEEEFFFF"],
    ["github token", "clone failed ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
    ["slack token", "post failed xoxb-1234567890-ABCDEFGHIJKL"],
    ["aws key id", "denied for AKIAIOSFODNN7EXAMPLE"],
    ["bearer header", "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"],
    ["assignment", 'connect({ apiKey: "hunter2secretvalue" })'],
    ["env style", "ANTHROPIC_TOKEN=abcd1234efgh5678"],
  ];

  for (const [name, input] of cases) {
    test(name, () => {
      const scrubbed = scrubText(input);

      expect(scrubbed).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345");
      expect(scrubbed).not.toContain("sk-proj-AAAABBBBCCCCDDDDEEEEFFFF");
      expect(scrubbed).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
      expect(scrubbed).not.toContain("xoxb-1234567890-ABCDEFGHIJKL");
      expect(scrubbed).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
      expect(scrubbed).not.toContain("hunter2secretvalue");
      expect(scrubbed).not.toContain("abcd1234efgh5678");
    });
  }
});

test("scrubText removes email addresses", () => {
  const scrubbed = scrubText("owner alice@example.com could not be notified");

  expect(scrubbed).not.toContain("alice@example.com");
  expect(scrubbed).toContain("[email]");
});

test("scrubText replaces the home directory with a tilde", () => {
  const scrubbed = scrubText(`ENOENT at ${homedir()}/.nakama/config.ini`);

  expect(scrubbed).not.toContain(homedir());
  expect(scrubbed).toContain("~/.nakama/config.ini");
});

test("scrubText replaces home paths belonging to another user", () => {
  const scrubbed = scrubText("read failed: /Users/someoneelse/.nakama/orgs/a.db");

  expect(scrubbed).not.toContain("someoneelse");
  expect(scrubbed).toContain("~/.nakama/orgs/a.db");
});

test("scrubText keeps the diagnostic parts of a stack frame", () => {
  const scrubbed = scrubText("TypeError: cannot read tools at resolveTools (~/src/a.ts:12:3)");

  expect(scrubbed).toContain("TypeError");
  expect(scrubbed).toContain("resolveTools");
  expect(scrubbed).toContain("a.ts:12:3");
});

test("scrubText truncates runaway text", () => {
  const scrubbed = scrubText("x".repeat(10_000));

  expect(scrubbed.length).toBeLessThanOrEqual(4_001);
});

describe("scrubBreadcrumbData", () => {
  test("drops every key that is not allowlisted", () => {
    const scrubbed = scrubBreadcrumbData({
      tool: "bash",
      prompt: "summarise the patient record for Budi",
      toolArgs: { command: "cat ~/.ssh/id_rsa" },
      orgName: "orgx",
      messages: ["hello"],
    });

    expect(scrubbed).toEqual({ tool: "bash", droppedKeys: 4 });
  });

  test("scrubs secrets inside an allowlisted value", () => {
    const scrubbed = scrubBreadcrumbData({
      provider: "anthropic key sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345",
    });

    expect(scrubbed?.provider).not.toContain("sk-ant-api03");
  });

  test("keeps numbers and booleans on allowlisted keys", () => {
    expect(scrubBreadcrumbData({ status: 500, durationMs: 12, count: 3 })).toEqual({
      status: 500,
      durationMs: 12,
      count: 3,
    });
  });

  test("drops an allowlisted key holding a nested object", () => {
    expect(scrubBreadcrumbData({ tool: { name: "bash" } })).toEqual({ droppedKeys: 1 });
  });

  test("returns undefined when nothing survives", () => {
    expect(scrubBreadcrumbData(undefined)).toBeUndefined();
  });
});

describe("hashId", () => {
  test("is stable and does not leak the input", () => {
    const id = "org_01JABCDEF";

    expect(hashId(id)).toBe(hashId(id));
    expect(hashId(id)).not.toContain(id);
    expect(hashId(id)).toHaveLength(12);
  });

  test("is undefined for empty input", () => {
    expect(hashId("")).toBeUndefined();
    expect(hashId(null)).toBeUndefined();
  });
});
