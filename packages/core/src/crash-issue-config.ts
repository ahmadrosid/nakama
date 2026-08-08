import { join } from "node:path";
import { parseIni, readTextOrNull } from "./fs";
import { getUserConfigDir } from "./user-config";

/**
 * Only the maintainer of the project being reported on configures this, which is what
 * keeps the issue-filing tool absent from every other install.
 */
export interface CrashIssueConfig {
  maxIssuesPerHour: number;
  repo: string | null;
  token: string | null;
}

export const DEFAULT_MAX_ISSUES_PER_HOUR = 5;

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function getCrashIssueConfigPath(): string {
  return join(getUserConfigDir(), "crash-issues.ini");
}

/**
 * Rejects anything that is not exactly owner/name. The value is interpolated into the
 * GitHub API path, so a slash or a traversal segment here would reach a different
 * endpoint than the one configured.
 */
export function parseCrashIssueRepo(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();

  if (!(trimmed && REPO_PATTERN.test(trimmed))) {
    return null;
  }

  return trimmed;
}

function parseMaxIssuesPerHour(value: string | undefined): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_ISSUES_PER_HOUR;
}

export async function loadCrashIssueConfigFile(): Promise<CrashIssueConfig> {
  const raw = await readTextOrNull(getCrashIssueConfigPath());

  if (raw === null) {
    return {
      maxIssuesPerHour: DEFAULT_MAX_ISSUES_PER_HOUR,
      repo: null,
      token: null,
    };
  }

  const values = parseIni(raw);

  return {
    maxIssuesPerHour: parseMaxIssuesPerHour(values.max_issues_per_hour),
    repo: parseCrashIssueRepo(values.repo),
    token: values.token?.trim() || null,
  };
}

export function resolveCrashIssueConfig(
  file: CrashIssueConfig,
  env: Record<string, string | undefined> = process.env
): CrashIssueConfig {
  return {
    maxIssuesPerHour: file.maxIssuesPerHour,
    repo: parseCrashIssueRepo(env.NAKAMA_CRASH_ISSUE_REPO) ?? file.repo,
    token: env.NAKAMA_CRASH_ISSUE_TOKEN?.trim() || file.token,
  };
}

export function isCrashIssueConfigured(config: CrashIssueConfig): boolean {
  return Boolean(config.repo && config.token);
}

export async function loadCrashIssueConfig(): Promise<CrashIssueConfig> {
  return resolveCrashIssueConfig(await loadCrashIssueConfigFile());
}
