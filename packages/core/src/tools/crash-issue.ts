import { join } from "node:path";
import { z } from "zod";
import type { JsonSchema, ToolDefinition } from "../contract";
import {
  isCrashIssueConfigured,
  loadCrashIssueConfig,
  type CrashIssueConfig,
} from "../crash-issue-config";
import { readTextOrNull, writePrivateTextFile } from "../fs";
import { getUserConfigDir } from "../user-config";

export const CRASH_ISSUE_TOOL_NAME = "crash_issue";

const GITHUB_API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
const HOUR_MS = 60 * 60 * 1_000;

/**
 * Written into every filed issue so the same crash can be recognised later from GitHub
 * alone, without this install being the only place that remembers.
 */
export function crashFingerprintMarker(fingerprint: string): string {
  return `nakama-crash-fingerprint: ${fingerprint}`;
}

export interface FiledCrashIssue {
  url: string;
  number: number;
  at: number;
}

export type FiledCrashIssueStore = Record<string, FiledCrashIssue>;

export function getFiledCrashIssuesPath(): string {
  return join(getUserConfigDir(), "crash-issues.json");
}

export async function readFiledCrashIssues(): Promise<FiledCrashIssueStore> {
  const raw = await readTextOrNull(getFiledCrashIssuesPath());

  if (raw === null) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as FiledCrashIssueStore)
      : {};
  } catch {
    return {};
  }
}

async function recordFiledCrashIssue(
  fingerprint: string,
  entry: FiledCrashIssue,
): Promise<void> {
  const store = await readFiledCrashIssues();
  store[fingerprint] = entry;

  await writePrivateTextFile(
    getFiledCrashIssuesPath(),
    `${JSON.stringify(store, null, 2)}\n`,
    { ensureDir: getUserConfigDir() },
  );
}

export function countIssuesFiledSince(store: FiledCrashIssueStore, sinceMs: number): number {
  return Object.values(store).filter((entry) => entry.at >= sinceMs).length;
}

/**
 * An error message from a self-hosted install is attacker-controllable, and it reaches
 * this tool through whatever the triage agent read. Backticking mentions stops that text
 * from turning into a mass ping on the repo. The narrower guards (one fixed repo, one
 * issue per fingerprint, a cap per hour) are what keep the rest of the blast radius small.
 */
export function neutralizeMentions(value: string): string {
  return value.replace(/@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)/g, "`@$1`");
}

export const crashIssueInputSchema = z
  .object({
    action: z
      .enum(["find", "file"])
      .describe("find checks whether this crash already has an issue. file creates one."),
    fingerprint: z
      .string()
      .regex(/^[0-9a-f]{8,64}$/, "fingerprint must be the lowercase hex crash fingerprint")
      .describe("The crash fingerprint from the report."),
    title: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe("Issue title. Required for file."),
    summary: z
      .string()
      .min(1)
      .max(6_000)
      .optional()
      .describe(
        "Issue body: what breaks, the stack, how many installs are affected. Required for file.",
      ),
  })
  .strict();

export type CrashIssueInput = z.infer<typeof crashIssueInputSchema>;

export interface CrashIssueOutput {
  action: "find" | "file";
  fingerprint: string;
  found: boolean;
  created: boolean;
  url?: string;
  number?: number;
  reason?: string;
}

export function crashIssueParameters(): JsonSchema {
  const { $schema, ...schema } = crashIssueInputSchema.toJSONSchema();
  return schema as JsonSchema;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nakama-crash-triage",
    "Content-Type": "application/json",
  };
}

async function searchExistingIssue(
  config: CrashIssueConfig,
  fingerprint: string,
): Promise<{ url: string; number: number } | null> {
  const query = `repo:${config.repo} is:issue "${crashFingerprintMarker(fingerprint)}"`;
  const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;

  const response = await fetch(url, {
    headers: githubHeaders(config.token!),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${CRASH_ISSUE_TOOL_NAME}: GitHub search failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    items?: Array<{ html_url?: string; number?: number }>;
  };
  const first = payload.items?.[0];

  return first?.html_url && typeof first.number === "number"
    ? { url: first.html_url, number: first.number }
    : null;
}

async function createIssue(
  config: CrashIssueConfig,
  input: { title: string; summary: string; fingerprint: string },
): Promise<{ url: string; number: number }> {
  const body = [
    neutralizeMentions(input.summary),
    "",
    `<!-- ${crashFingerprintMarker(input.fingerprint)} -->`,
    "",
    "Filed automatically from a crash report. Deduplicated by fingerprint.",
  ].join("\n");

  const response = await fetch(`${GITHUB_API_BASE}/repos/${config.repo}/issues`, {
    method: "POST",
    headers: githubHeaders(config.token!),
    body: JSON.stringify({
      title: neutralizeMentions(input.title),
      body,
      labels: ["crash-report"],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${CRASH_ISSUE_TOOL_NAME}: GitHub issue create failed (${response.status}).`);
  }

  const payload = (await response.json()) as { html_url?: string; number?: number };

  if (!payload.html_url || typeof payload.number !== "number") {
    throw new Error(`${CRASH_ISSUE_TOOL_NAME}: GitHub returned an unusable issue payload.`);
  }

  return { url: payload.html_url, number: payload.number };
}

async function resolveExisting(
  config: CrashIssueConfig,
  fingerprint: string,
): Promise<{ url: string; number: number } | null> {
  const local = (await readFiledCrashIssues())[fingerprint];

  if (local) {
    return { url: local.url, number: local.number };
  }

  const remote = await searchExistingIssue(config, fingerprint);

  if (remote) {
    await recordFiledCrashIssue(fingerprint, { ...remote, at: Date.now() });
  }

  return remote;
}

export const crashIssueTool: ToolDefinition<CrashIssueInput, CrashIssueOutput> = {
  name: CRASH_ISSUE_TOOL_NAME,
  description:
    "Find or file a GitHub issue for a crash fingerprint in the configured repository. " +
    "Filing is deduplicated by fingerprint and capped per hour, so calling file twice for " +
    "the same crash returns the existing issue instead of creating another.",
  parameters: crashIssueParameters(),
  async run(input) {
    let parsed: CrashIssueInput;

    try {
      parsed = crashIssueInputSchema.parse(input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issue = err.issues[0];
        const at = issue?.path?.length ? ` at ${issue.path.join(".")}` : "";
        throw new Error(`${CRASH_ISSUE_TOOL_NAME}: invalid parameter${at}: ${issue?.message}`);
      }

      throw err instanceof Error ? err : new Error(String(err));
    }

    const config = await loadCrashIssueConfig();

    if (!isCrashIssueConfigured(config)) {
      throw new Error(
        `${CRASH_ISSUE_TOOL_NAME}: no repository configured. Set repo and token in ~/.nakama/crash-issues.ini.`,
      );
    }

    const existing = await resolveExisting(config, parsed.fingerprint);

    if (existing) {
      return {
        action: parsed.action,
        fingerprint: parsed.fingerprint,
        found: true,
        created: false,
        url: existing.url,
        number: existing.number,
        ...(parsed.action === "file" ? { reason: "already filed" } : {}),
      };
    }

    if (parsed.action === "find") {
      return {
        action: "find",
        fingerprint: parsed.fingerprint,
        found: false,
        created: false,
      };
    }

    if (!parsed.title || !parsed.summary) {
      throw new Error(`${CRASH_ISSUE_TOOL_NAME}: file requires both title and summary.`);
    }

    // Deduplication alone does not bound this: a crafted error message produces a new
    // fingerprint every time, so without a cap one injected report could open issues until
    // the repo is unusable.
    const filedThisHour = countIssuesFiledSince(
      await readFiledCrashIssues(),
      Date.now() - HOUR_MS,
    );

    if (filedThisHour >= config.maxIssuesPerHour) {
      return {
        action: "file",
        fingerprint: parsed.fingerprint,
        found: false,
        created: false,
        reason: `hourly cap reached (${filedThisHour}/${config.maxIssuesPerHour}); not filed`,
      };
    }

    const created = await createIssue(config, {
      title: parsed.title,
      summary: parsed.summary,
      fingerprint: parsed.fingerprint,
    });

    await recordFiledCrashIssue(parsed.fingerprint, { ...created, at: Date.now() });

    return {
      action: "file",
      fingerprint: parsed.fingerprint,
      found: false,
      created: true,
      url: created.url,
      number: created.number,
    };
  },
};
