import { expect, test } from "bun:test";
import {
  type CrashIssueConfig,
  DEFAULT_MAX_ISSUES_PER_HOUR,
  isCrashIssueConfigured,
  parseCrashIssueRepo,
  resolveCrashIssueConfig,
} from "./crash-issue-config";

const empty: CrashIssueConfig = {
  maxIssuesPerHour: DEFAULT_MAX_ISSUES_PER_HOUR,
  repo: null,
  token: null,
};

test("a well formed repository is accepted", () => {
  expect(parseCrashIssueRepo("ahmadrosid/nakama")).toBe("ahmadrosid/nakama");
  expect(parseCrashIssueRepo("  owner/name  ")).toBe("owner/name");
});

test("anything that could reach another endpoint is rejected", () => {
  // The value is interpolated into the GitHub API path, so these must not survive.
  for (const value of [
    "owner/name/../../other",
    "owner",
    "owner/name/issues",
    "../etc/passwd",
    "owner/name?x=1",
    "https://api.github.com/repos/owner/name",
    "",
    null,
  ]) {
    expect(parseCrashIssueRepo(value)).toBeNull();
  }
});

test("env settles the repository and token for a headless triage host", () => {
  const resolved = resolveCrashIssueConfig(empty, {
    NAKAMA_CRASH_ISSUE_REPO: "owner/name",
    NAKAMA_CRASH_ISSUE_TOKEN: "gh-token",
  });

  expect(resolved.repo).toBe("owner/name");
  expect(resolved.token).toBe("gh-token");
  expect(isCrashIssueConfigured(resolved)).toBe(true);
});

test("a bad repository in env does not fall through as configured", () => {
  const resolved = resolveCrashIssueConfig(empty, {
    NAKAMA_CRASH_ISSUE_REPO: "not a repo",
    NAKAMA_CRASH_ISSUE_TOKEN: "gh-token",
  });

  expect(resolved.repo).toBeNull();
  expect(isCrashIssueConfigured(resolved)).toBe(false);
});

test("a token without a repository is not configured", () => {
  expect(isCrashIssueConfigured({ ...empty, token: "gh-token" })).toBe(false);
});

test("an unconfigured install is the default", () => {
  expect(isCrashIssueConfigured(resolveCrashIssueConfig(empty, {}))).toBe(
    false
  );
});
