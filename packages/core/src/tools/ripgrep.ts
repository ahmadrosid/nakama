import { spawn } from "node:child_process";
import path from "node:path";

export const DEFAULT_MAX_RESULTS = 50;
export const MAX_RESULTS_LIMIT = 200;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_OUTPUT_CHARS = 32_000;

export interface RipgrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface RipgrepSearchResult {
  matches: RipgrepMatch[];
  truncated: boolean;
}

let rgCommandPromise: Promise<string> | null = null;

interface MatchParseResult {
  match: RipgrepMatch | null;
  chars: number;
}

export function buildRipgrepArgs(options: {
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
    "--ignore-case",
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

export async function runRipgrep(
  args: string[],
  options: { workspaceRoot: string; searchRoot: string; maxResults: number },
): Promise<RipgrepSearchResult> {
  const command = await resolveRipgrepCommand();

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stderr = "";
    let stdoutBuffer = "";
    const matches: RipgrepMatch[] = [];
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
      if ("code" in error && error.code === "ENOENT") {
        reject(
          new Error(
            'ripgrep binary not found. Install the optional "@vscode/ripgrep" package for this platform or make `rg` available on PATH.',
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        reject(new Error(`ripgrep search timed out after ${DEFAULT_TIMEOUT_MS}ms.`));
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
            ? `ripgrep search failed with exit code ${code}: ${stderrExcerpt}`
            : `ripgrep search failed with exit code ${code}.`,
        ),
      );
    });
  });
}

async function resolveRipgrepCommand(): Promise<string> {
  if (!rgCommandPromise) {
    rgCommandPromise = loadRipgrepCommand();
  }

  return await rgCommandPromise;
}

async function loadRipgrepCommand(): Promise<string> {
  try {
    const ripgrep = await import("@vscode/ripgrep");
    if (typeof ripgrep.rgPath === "string" && ripgrep.rgPath.trim()) {
      return ripgrep.rgPath;
    }
  } catch {
    // Fall back to PATH lookup so runtimes that never use search tools do not crash on import.
  }

  return "rg";
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
  } satisfies RipgrepMatch;

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

export function readRequiredString(input: unknown, key: string): string {
  const value = readOptionalString(input, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

export function readOptionalString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readOptionalBoolean(input: unknown, key: string): boolean | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

export function readMaxResults(input: unknown): number {
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
