import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";

const JsonValueSchema = z.json();

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

type JsonValue = z.infer<typeof JsonValueSchema>;

type JsonObject = z.infer<typeof JsonObjectSchema>;

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
  chars: number;
  match: RipgrepMatch | null;
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
  options: { workspaceRoot: string; searchRoot: string; maxResults: number }
): Promise<RipgrepSearchResult> {
  if (!path.isAbsolute(options.workspaceRoot)) {
    throw new Error(
      "workspaceRoot must be an absolute path; relative roots resolve against process.cwd() and break profile isolation."
    );
  }

  if (!path.isAbsolute(options.searchRoot)) {
    throw new Error(
      "searchRoot must be an absolute path; relative roots resolve against process.cwd() and break profile isolation."
    );
  }

  const command = await resolveRipgrepCommand();

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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

        const parsed = parseMatchLine(
          line,
          options.workspaceRoot,
          options.searchRoot
        );

        if (!parsed.match) {
          continue;
        }

        if (matches.length < options.maxResults) {
          matches.push(parsed.match);
          collectedChars += parsed.chars;
        }

        if (
          matches.length >= options.maxResults ||
          collectedChars >= MAX_OUTPUT_CHARS
        ) {
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
            'ripgrep binary not found. Install the optional "@vscode/ripgrep" package for this platform or make `rg` available on PATH.'
          )
        );

        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        reject(
          new Error(`ripgrep search timed out after ${DEFAULT_TIMEOUT_MS}ms.`)
        );

        return;
      }

      if (stdoutBuffer.trim()) {
        const parsed = parseMatchLine(
          stdoutBuffer.trim(),
          options.workspaceRoot,
          options.searchRoot
        );

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
            : `ripgrep search failed with exit code ${code}.`
        )
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

    const rgPath = z.string().trim().min(1).safeParse(ripgrep.rgPath);

    if (rgPath.success) {
      return rgPath.data;
    }
  } catch {
    // Fall back to PATH lookup so runtimes that never use search tools do not crash on import.
  }

  return "rg";
}

function parseMatchLine(
  line: string,
  workspaceRoot: string,
  searchRoot: string
): MatchParseResult {
  const payload = parseJsonRecord(line);

  if (!payload || payload.type !== "match") {
    return { chars: 0, match: null };
  }

  const data = readRecord(payload, "data");

  if (!data) {
    return { chars: 0, match: null };
  }

  const rawPath = readNestedString(data, "path", "text");
  const rawText = readNestedString(data, "lines", "text");
  const lineNumber = readNumber(data, "line_number");

  if (!(rawPath && rawText && lineNumber)) {
    return { chars: 0, match: null };
  }

  const absolutePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(searchRoot, rawPath);

  const relativePath = path.relative(workspaceRoot, absolutePath) || ".";
  const trimmedText = rawText.trim();

  const match = {
    file: relativePath,
    line: lineNumber,
    text: trimmedText,
  } satisfies RipgrepMatch;

  return {
    chars: relativePath.length + trimmedText.length + String(lineNumber).length,
    match,
  };
}

function parseJsonRecord(line: string): JsonObject | null {
  try {
    const parsed = JsonValueSchema.safeParse(JSON.parse(line));

    return parsed.success ? readRecord(parsed.data) : null;
  } catch {
    return null;
  }
}

function readRecord(input: JsonValue, key?: string): JsonObject | null {
  const source = JsonObjectSchema.safeParse(input);

  if (!source.success) {
    return null;
  }

  const parsed = JsonObjectSchema.safeParse(key ? source.data[key] : input);

  return parsed.success ? parsed.data : null;
}

function readNestedString(
  input: JsonValue,
  parentKey: string,
  childKey: string
): string | null {
  const parent = readRecord(input, parentKey);

  if (!parent) {
    return null;
  }

  const value = z.string().safeParse(parent[childKey]);

  return value.success ? value.data : null;
}

function readNumber(input: JsonValue, key: string): number | null {
  const record = readRecord(input);

  if (!record) {
    return null;
  }

  const value = record[key];

  const parsed = z.number().finite().safeParse(value);

  return parsed.success ? parsed.data : null;
}
