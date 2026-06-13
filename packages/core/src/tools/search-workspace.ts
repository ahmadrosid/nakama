import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { rgPath } from "@vscode/ripgrep";
import type { ToolContext, ToolDefinition } from "../contract";
import { getProfileSoulDir } from "../soul/resolve";
import { guardFilePath } from "./paths";

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 32_000;

export interface SearchWorkspaceInput {
  query: string;
  path?: string;
  glob?: string;
  regex?: boolean;
  maxResults?: number;
}

export interface SearchWorkspaceMatch {
  file: string;
  line: number;
  text: string;
}

export interface SearchWorkspaceOutput {
  query: string;
  root: string;
  matches: SearchWorkspaceMatch[];
  matchCount: number;
  truncated: boolean;
}

interface SearchWorkspaceOptions {
  workspaceRoot?: string;
}

interface MatchParseResult {
  match: SearchWorkspaceMatch | null;
  chars: number;
}

export const searchWorkspaceTool: ToolDefinition<SearchWorkspaceInput, SearchWorkspaceOutput> = {
  name: "search_workspace",
  description:
    "Search text in files under the active profile workspace and return compact matching snippets.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keyword or regex pattern to search for.",
      },
      path: {
        type: "string",
        description: "Optional file or subdirectory within the profile workspace.",
      },
      glob: {
        type: "string",
        description: "Optional ripgrep glob filter such as *.md or data/**.",
      },
      regex: {
        type: "boolean",
        description: "Treat query as regex when true. Defaults to true.",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of matches to return. Defaults to 50, max 200.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  run(input, context) {
    return runSearchWorkspace(input, context);
  },
};

export async function runSearchWorkspace(
  input: unknown,
  context: ToolContext,
  options: SearchWorkspaceOptions = {},
): Promise<SearchWorkspaceOutput> {
  const profileId = context.profileId?.trim();
  if (!profileId) {
    throw new Error("profileId is required.");
  }

  const query = readRequiredString(input, "query");
  const subPath = readOptionalString(input, "path");
  const glob = readOptionalString(input, "glob");
  const regex = readOptionalBoolean(input, "regex") ?? true;
  const maxResults = readMaxResults(input);

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ?? getProfileSoulDir(profileId),
  );
  const searchRoot = await resolveSearchRoot(workspaceRoot, subPath);
  const args = buildRipgrepArgs({
    query,
    searchRoot,
    glob,
    regex,
    maxResults,
  });

  const searchResult = await runRipgrep(args, {
    workspaceRoot,
    searchRoot,
    maxResults,
  });

  return {
    query,
    root: searchRoot,
    matches: searchResult.matches,
    matchCount: searchResult.matches.length,
    truncated: searchResult.truncated,
  };
}

async function resolveSearchRoot(
  workspaceRoot: string,
  subPath: string | null,
): Promise<string> {
  if (!subPath) {
    return workspaceRoot;
  }

  const guarded = await guardFilePath(subPath, workspaceRoot, undefined, {
    allowedDirs: [workspaceRoot],
    cwd: workspaceRoot,
  });
  return guarded.resolved;
}

async function resolveWorkspaceRoot(rawWorkspaceRoot: string): Promise<string> {
  try {
    return await realpath(rawWorkspaceRoot);
  } catch {
    return path.resolve(rawWorkspaceRoot);
  }
}

function buildRipgrepArgs(options: {
  query: string;
  searchRoot: string;
  glob: string | null;
  regex: boolean;
  maxResults: number;
}): string[] {
  const args = [
    "--json",
    "--line-number",
    "--no-heading",
    "--max-count",
    String(options.maxResults),
  ];

  if (!options.regex) {
    args.push("--fixed-strings");
  }

  if (options.glob) {
    args.push("--glob", options.glob);
  }

  args.push("--", options.query, options.searchRoot);
  return args;
}

async function runRipgrep(
  args: string[],
  options: { workspaceRoot: string; searchRoot: string; maxResults: number },
): Promise<{ matches: SearchWorkspaceMatch[]; truncated: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stderr = "";
    let stdoutBuffer = "";
    const matches: SearchWorkspaceMatch[] = [];
    let collectedChars = 0;
    let truncated = false;
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);

    const maybeStopForLimits = (): void => {
      if (truncated) {
        child.kill("SIGTERM");
      }
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        const parsed = parseMatchLine(line, options.workspaceRoot, options.searchRoot);
        if (!parsed.match) {
          continue;
        }

        if (matches.length < options.maxResults) {
          matches.push(parsed.match);
          collectedChars += parsed.chars;
        }

        if (matches.length >= options.maxResults || collectedChars >= MAX_OUTPUT_CHARS) {
          truncated = true;
          maybeStopForLimits();
          break;
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
      if (stderr.length > MAX_OUTPUT_CHARS) {
        stderr = stderr.slice(0, MAX_OUTPUT_CHARS);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        reject(new Error(`search_workspace timed out after ${DEFAULT_TIMEOUT_MS}ms.`));
        return;
      }

      if (stdoutBuffer.trim()) {
        const parsed = parseMatchLine(stdoutBuffer.trim(), options.workspaceRoot, options.searchRoot);
        if (
          parsed.match &&
          matches.length < options.maxResults &&
          collectedChars + parsed.chars < MAX_OUTPUT_CHARS
        ) {
          matches.push(parsed.match);
          collectedChars += parsed.chars;
        } else if (parsed.match) {
          truncated = true;
        }
      }

      if (code === 0 || code === 1 || (truncated && code === null)) {
        resolve({ matches, truncated });
        return;
      }

      const stderrExcerpt = stderr.trim().slice(0, 500);
      reject(
        new Error(
          stderrExcerpt
            ? `search_workspace failed with exit code ${code}: ${stderrExcerpt}`
            : `search_workspace failed with exit code ${code}.`,
        ),
      );
    });
  });
}

function parseMatchLine(
  line: string,
  workspaceRoot: string,
  searchRoot: string,
): MatchParseResult {
  const payload = parseJsonRecord(line);
  if (!payload || payload.type !== "match") {
    return { match: null, chars: 0 };
  }

  const data = readRecord(payload, "data");
  if (!data) {
    return { match: null, chars: 0 };
  }

  const rawPath = readNestedString(data, "path", "text");
  const rawText = readNestedString(data, "lines", "text");
  const lineNumber = readNumber(data, "line_number");

  if (!rawPath || !rawText || !lineNumber) {
    return { match: null, chars: 0 };
  }

  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(searchRoot, rawPath);
  const relativePath = path.relative(workspaceRoot, absolutePath) || ".";
  const trimmedText = rawText.trim();
  const match = {
    file: relativePath,
    line: lineNumber,
    text: trimmedText,
  } satisfies SearchWorkspaceMatch;

  return {
    match,
    chars: relativePath.length + trimmedText.length + String(lineNumber).length,
  };
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return readRecord({ value: parsed }, "value");
  } catch {
    return null;
  }
}

function readRecord(
  input: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = input[key];
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readRequiredString(input: unknown, key: string): string {
  const value = readOptionalString(input, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function readOptionalString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalBoolean(input: unknown, key: string): boolean | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

function readMaxResults(input: unknown): number {
  if (typeof input !== "object" || input === null || !("maxResults" in input)) {
    return DEFAULT_MAX_RESULTS;
  }

  const rawValue = (input as Record<string, unknown>).maxResults;
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return DEFAULT_MAX_RESULTS;
  }

  const normalized = Math.floor(rawValue);
  if (normalized <= 0) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(normalized, MAX_RESULTS_LIMIT);
}

function readNestedString(
  input: Record<string, unknown>,
  parentKey: string,
  childKey: string,
): string | null {
  const parent = readRecord(input, parentKey);
  if (!parent) {
    return null;
  }
  const value = parent[childKey];
  return typeof value === "string" ? value : null;
}

function readNumber(input: Record<string, unknown>, key: string): number | null {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
