import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  comparablePath,
  getProfileSoulDir,
  getUserConfigDir,
  guardFilePath,
  resolveWithRealpath,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import { getToolExecutionEnv } from "../lib/ensure-process-path";
import { mergeCodingAgentSpawnEnv } from "../services/coding-agent-spawn-env";
import { killProcessTree } from "../services/custom-tool-subprocess";
import {
  isTenantBashEnabled,
  resolveBashBackend,
  TENANT_BASH_DISABLED,
} from "./bash-config";
import { remoteBashDescription, runRemoteBash } from "./bash-remote";
import {
  commandLooksLikeCursorAgent,
  formatCodingAgentBashStdout,
} from "./cursor-agent-output";

const DEFAULT_TIMEOUT_MS = 30_000;

const MAX_TIMEOUT_MS = 30 * 60_000;

const MAX_OUTPUT_CHARS = 32_000;

const EXIT_STDIO_GRACE_MS = 100;

/** In-memory capture for coding-agent runs before summarize / keep-tail. */
const CODING_AGENT_MAX_CAPTURE_CHARS = 5_000_000;

/** Keep the newest N coding-agent logs; prune the rest after each write. */
const CODING_AGENT_LOG_RETENTION = 10;

export interface BashInput {
  codingAgent?: boolean;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface BashOutput {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

interface BashRunOptions {
  workspaceRoot?: string;
}

interface ShellRunOptions {
  codingAgentMode: boolean;
  signal?: AbortSignal;
  workspaceRoot: string;
}

const BASH_TOOL_DESCRIPTION_BASE =
  "Run a one-off shell command and return stdout, stderr, and exit code. In local CLI sessions, commands start in the directory where the CLI was launched; otherwise they start in the active profile workspace. Do not use this to create persistent tools, tool files, shell wrappers, or .sh scripts. If the user wants a reusable tool, translate shell examples into JavaScript instead.";

function bashToolDescription(): string {
  if (resolveBashBackend() === "remote") {
    return `${BASH_TOOL_DESCRIPTION_BASE} ${remoteBashDescription()}`;
  }

  return `${BASH_TOOL_DESCRIPTION_BASE} Host execution is unrestricted by Nakama and uses the server process's OS permissions. Commands can access files outside the profile workspace, including other profiles' files when OS permissions allow. Assign host bash only to trusted profiles.`;
}

export const bashTool: ToolDefinition<BashInput, BashOutput> = {
  description: bashToolDescription(),
  name: "bash",
  parameters: {
    additionalProperties: false,
    properties: {
      codingAgent: {
        description:
          "When true, Nakama merges coding-agent spawn env (provider passthrough) for this command.",
        type: "boolean",
      },
      command: { description: "Shell command to run.", type: "string" },
      cwd: {
        description:
          "Optional working directory within the active shell workspace. Defaults to the CLI launch directory in local CLI sessions, or the profile workspace otherwise.",
        type: "string",
      },
      env: {
        additionalProperties: { type: "string" },
        description:
          "Optional environment variables to merge into the spawned shell process.",
        type: "object",
      },
      timeoutMs: {
        description:
          "Timeout in milliseconds. Defaults to 30000, max 1800000 (30 minutes).",
        type: "number",
      },
    },
    required: ["command"],
    type: "object",
  },
  run(input, context) {
    return runBash(input, context);
  },
};

export async function runBash(
  input: BashInput,
  context: ToolContext,
  options: BashRunOptions = {}
): Promise<BashOutput> {
  const profileId = context.profileId?.trim();
  const orgId = context.orgId?.trim();

  if (!profileId) {
    throw new Error("profileId is required.");
  }

  if (!orgId) {
    throw new Error("orgId is required.");
  }

  // Seeding and assignment also drop bash when it is off, but a profile can
  // still hold it from before (or via clone), so this is the gate that counts.
  // The CLI channel is the operator's own terminal.
  if (context.channel !== "cli" && !isTenantBashEnabled()) {
    throw new Error(TENANT_BASH_DISABLED);
  }

  const command = input.command.trim();

  if (!command) {
    throw new Error("command is required.");
  }

  const codingAgentMode =
    input.codingAgent === true || commandLooksLikeCursorAgent(command);

  // The CLI channel stays on host bash: it is the operator's own terminal.
  if (context.channel !== "cli" && resolveBashBackend() === "remote") {
    return runRemoteBash({
      codingAgent: codingAgentMode,
      command,
      cwd: input.cwd,
      env: input.env,
      orgId,
      profileId,
      signal: context.signal,
      timeoutMs: readTimeout(input.timeoutMs),
    });
  }

  const codingWorkspace =
    context.channel === "cli" || codingAgentMode
      ? context.codingWorkspaceRoot
      : undefined;

  const workspaceRoot = await resolveWorkspaceRoot(
    options.workspaceRoot ??
      codingWorkspace ??
      context.workspaceRoot ??
      getProfileSoulDir(orgId, profileId)
  );

  const rawCwd = input.cwd?.trim() ?? "";

  const cwd = rawCwd
    ? (
        await guardFilePath(rawCwd, workspaceRoot, undefined, {
          allowedDirs: [workspaceRoot],
          cwd: workspaceRoot,
        })
      ).resolved
    : workspaceRoot;

  refuseNakamaStateAccess(command, cwd, [
    workspaceRoot,
    getProfileSoulDir(orgId, profileId),
  ]);

  const timeoutMs = readTimeout(input.timeoutMs);
  const env = input.env ?? {};

  return runShellCommand(command, cwd, timeoutMs, env, {
    codingAgentMode,
    signal: context.signal,
    workspaceRoot,
  });
}

/** Names that only Nakama's own secret state uses, refused wherever they appear. */
const NAKAMA_SECRET_FILE_PATTERN =
  /(?:^|[\s/=:<>(`])(?:config\.ini|local-auth-token|tool-credentials\.key|whatsapp-context-token|nakama\.(?:sqlite|db))(?=$|[\s;|&)<>`])/i;

/** Credential or database shapes, refused when the command also reaches the config dir. */
const NAKAMA_STATE_PATTERN =
  /\.(?:sqlite3?|db|ini|key)\b|\bsqlite3\b|token|\/auth\b/i;

const SHELL_WORD_DELIMITER = /[\s;|&<>()`]+/;

const OTHER_WORKSPACE_REFUSAL =
  "Refused: this command reaches into Nakama's org data outside this profile's workspace. Bash can only read this profile's own files. Use the Nakama tools assigned to this profile for anything else.";

const NAKAMA_STATE_REFUSAL =
  "Refused: this command reads Nakama's internal state (local auth token, config.ini, credential keys, or server SQLite databases). The bash tool cannot call the Nakama API or read its databases. Use the Nakama tools assigned to this profile; if no tool fits, tell the user what is missing.";

/**
 * Defense in depth, not a sandbox: refuse commands that name Nakama's secret
 * files or reach into the config dir for credentials and databases. Profile
 * workspaces under the config dir stay usable.
 */
function refuseNakamaStateAccess(
  command: string,
  cwd: string,
  workspaceDirs: string[]
): void {
  // Fold quoting, backslashes, and ${VAR} into one shape before matching.
  const normalized = command
    .replaceAll("\\", "/")
    .replace(/["']/g, "")
    .replace(/\$\{(\w+)\}/g, "$$$1");

  if (NAKAMA_SECRET_FILE_PATTERN.test(normalized)) {
    throw new Error(NAKAMA_STATE_REFUSAL);
  }

  if (
    NAKAMA_STATE_PATTERN.test(normalized) &&
    reachesNakamaConfigDir(normalized, cwd, workspaceDirs)
  ) {
    throw new Error(NAKAMA_STATE_REFUSAL);
  }

  // Other orgs' and profiles' files hold no secret-shaped name, so the
  // pattern gate above never sees them. Anything under orgs/ outside this
  // profile's workspace is refused.
  if (reachesNakamaConfigDir(normalized, cwd, workspaceDirs, "orgs")) {
    throw new Error(OTHER_WORKSPACE_REFUSAL);
  }
}

function reachesNakamaConfigDir(
  command: string,
  cwd: string,
  workspaceDirs: string[],
  subdir = ""
): boolean {
  const configDir = path.resolve(getUserConfigDir());
  const configRoots = [configDir, resolveWithRealpath(configDir)];
  const scopes = configRoots.map((root) => path.join(root, subdir));

  const exemptDirs = workspaceDirs
    .flatMap((dir) => [path.resolve(dir), resolveWithRealpath(dir)])
    .filter((dir) =>
      configRoots.some((root) => isInsideDir(dir, root) && dir !== root)
    );

  // With a subdir, a parent of it inside the config dir counts too:
  // `grep -r x ~/.nakama` reads orgs/.
  const reachesState = (target: string) =>
    configRoots.some((root) => isInsideDir(target, root)) &&
    scopes.some(
      (scope) =>
        isInsideDir(target, scope) ||
        (subdir !== "" && isInsideDir(scope, target))
    ) &&
    !exemptDirs.some((dir) => isInsideDir(target, dir));

  const homeRelative = path
    .relative(homedir(), configDir)
    .replaceAll("\\", "/");

  const prefixes = new Map<string, string>([["$NAKAMA_CONFIG_DIR", configDir]]);

  for (const root of configRoots) {
    prefixes.set(root.replaceAll("\\", "/"), root);
  }

  if (homeRelative && !homeRelative.startsWith("..")) {
    for (const home of ["~", "$HOME"]) {
      prefixes.set(`${home}/${homeRelative}`, configDir);
    }
  }

  for (const [prefix, root] of prefixes) {
    let index = command.indexOf(prefix);

    while (index !== -1) {
      const rest = command.slice(index + prefix.length);
      const tail = rest.split(SHELL_WORD_DELIMITER)[0] ?? "";

      if (
        (tail === "" || tail.startsWith("/")) &&
        reachesState(path.join(root, tail))
      ) {
        return true;
      }

      index = command.indexOf(prefix, index + prefix.length);
    }
  }

  // Globs never match the literal prefixes above: the shell expands
  // `~/.nak?ma/config.ini`, a glob inside a variable assignment, a bracket
  // expression, or a brace list only at command time. Substitute the
  // assignments this command makes, expand brace alternatives, resolve the
  // word against the cwd (which folds `..`), then compare segment by segment
  // against the scope root. A word pinned inside an exempt workspace keeps
  // its trailing globs, so ordinary workspace globs still run.
  const scopeSegments = pathSegments(path.join(configDir, subdir));
  const assignments = collectShellAssignments(command);

  for (const rawWord of command.split(SHELL_WORD_DELIMITER)) {
    const word = rawWord.replace(/^\w+=/, "");
    const substituted = substituteShellVars(word, assignments, configDir);

    if (!hasGlobChars(substituted)) {
      continue;
    }

    for (const alternative of expandBraces(substituted)) {
      const resolved = path.resolve(cwd, alternative);

      // A brace list can expand to a plain path (`~/.nak{ma,x}/...`), so those
      // alternatives go through the literal containment check instead.
      if (hasGlobChars(alternative)) {
        if (globWordReachesScope(resolved, scopeSegments, exemptDirs)) {
          return true;
        }
      } else if (reachesState(resolved)) {
        return true;
      }
    }
  }

  return command
    .split(SHELL_WORD_DELIMITER)
    .some(
      (word) => word.includes("..") && reachesState(path.resolve(cwd, word))
    );
}

function isInsideDir(target: string, dir: string): boolean {
  const relative = path.relative(comparablePath(dir), comparablePath(target));

  return (
    relative === "" || !(relative.startsWith("..") || path.isAbsolute(relative))
  );
}

/** Fold separators (and case on Windows) so glob words compare against real paths. */
function globComparable(value: string): string {
  const slashes = value.replaceAll("\\", "/");

  return process.platform === "win32" ? slashes.toLowerCase() : slashes;
}

function pathSegments(value: string): string[] {
  return globComparable(value)
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
}

/** Every shell glob family this gate can resolve: `*`, `?`, `[...]` and `{a,b}`. */
function hasGlobChars(word: string): boolean {
  return /[*?[{]/.test(word);
}

function segmentMatches(word: string, actual: string): boolean {
  return hasGlobChars(word)
    ? globWordToRegExp(word).test(actual)
    : word === actual;
}

/**
 * A shell word as a matcher for one concrete segment. `*` and `?` stay inside
 * the segment, `[...]` becomes a character class, and `{a,b}` becomes an
 * alternation, so a pattern that can name the scope root also matches it.
 */
function globWordToRegExp(word: string): RegExp {
  const source = translateGlob(word);

  return new RegExp(`^${source}$`);
}

const POSIX_CLASSES = {
  "[:alnum:]": "a-zA-Z0-9",
  "[:alpha:]": "a-zA-Z",
  "[:blank:]": " \\t",
  "[:digit:]": "0-9",
  "[:lower:]": "a-z",
  "[:space:]": "\\s",
  "[:upper:]": "A-Z",
  "[:word:]": "a-zA-Z0-9_",
  "[:xdigit:]": "0-9a-fA-F",
} satisfies Record<string, string>;

function findClosingBracket(word: string, openIndex: number): number {
  let index = openIndex + 1;

  if (word[index] === "!" || word[index] === "^") {
    index += 1;
  }

  if (word[index] === "]") {
    index += 1;
  }

  while (index < word.length) {
    if (word[index] === "[" && word[index + 1] === ":") {
      const classEnd = word.indexOf(":]", index + 2);

      if (classEnd !== -1) {
        index = classEnd + 2;
        continue;
      }
    }

    if (word[index] === "]") {
      return index;
    }

    index += 1;
  }

  return -1;
}

function translateGlob(word: string): string {
  let source = "";

  for (let index = 0; index < word.length; index += 1) {
    const ch = word[index] ?? "";

    if (ch === "?") {
      source += "[^/]";
      continue;
    }

    if (ch === "*") {
      source += "[^/]*";
      continue;
    }

    if (ch === "[") {
      const close = findClosingBracket(word, index);

      if (close !== -1) {
        source += translateBracket(word.slice(index + 1, close));
        index = close;
        continue;
      }
    }

    if (ch === "{") {
      const close = word.indexOf("}", index + 1);

      if (close !== -1) {
        const alternatives = word
          .slice(index + 1, close)
          .split(",")
          .map((part) => translateGlob(part));

        source += `(?:${alternatives.join("|")})`;
        index = close;
        continue;
      }
    }

    source += escapeRegExpChar(ch);
  }

  return source;
}

/** `[abc]`, `[a-z]`, `[]8]`, `[[:alnum:]]` and `[!abc]` as a character class. */
function translateBracket(body: string): string {
  if (body === "") {
    return "\\[\\]";
  }

  const negated = body.startsWith("!") || body.startsWith("^");
  const content = negated ? body.slice(1) : body;

  // One pass: escape backslash and `]`, and expand POSIX classes, so the
  // `\s` from `[:space:]` is not escaped again into a literal backslash.
  const escaped = content.replace(/\[:[a-z]+:\]|[\\\]]/g, (match) =>
    match.length === 1 ? `\\${match}` : (POSIX_CLASSES[match] ?? "")
  );

  return negated ? `[^/${escaped}]` : `[${escaped}]`;
}

function escapeRegExpChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `NAME=value` assignments this command makes, in order. */
function collectShellAssignments(command: string): Map<string, string> {
  const assignments = new Map<string, string>();

  for (const word of command.split(SHELL_WORD_DELIMITER)) {
    const match = /^([A-Za-z_]\w*)=(.*)$/.exec(word);

    if (match?.[1] !== undefined) {
      assignments.set(match[1], match[2] ?? "");
    }
  }

  return assignments;
}

/**
 * Expand the variable references a later word may hide the config dir behind.
 * A name assigned earlier in the same command wins; the shorthands this gate
 * already knows stay expanded. Unknown names stay literal, which keeps the
 * comparison conservative.
 */
function substituteShellVars(
  word: string,
  assignments: Map<string, string>,
  configDir: string
): string {
  const withVars = word.replace(
    /\$\{?([A-Za-z_]\w*)\}?/g,
    (whole, name: string) => {
      const assigned = assignments.get(name);

      if (assigned !== undefined) {
        return assigned;
      }

      if (name === "HOME") {
        return homedir();
      }

      if (name === "NAKAMA_CONFIG_DIR") {
        return configDir;
      }

      return whole;
    }
  );

  return expandHomePrefix(withVars, configDir);
}

/** Expand the leading home and config-dir shorthands a glob word may hide behind. */
function expandHomePrefix(word: string, configDir: string): string {
  if (word === "~" || word.startsWith("~/")) {
    return `${homedir()}${word.slice(1)}`;
  }

  if (word === "$HOME" || word.startsWith("$HOME/")) {
    return `${homedir()}${word.slice("$HOME".length)}`;
  }

  if (word.startsWith("$NAKAMA_CONFIG_DIR")) {
    return `${configDir}${word.slice("$NAKAMA_CONFIG_DIR".length)}`;
  }

  return word;
}

const MAX_BRACE_ALTERNATIVES = 1000;

function expandNumericSequence(
  startStr: string,
  endStr: string,
  stepStr?: string
): string[] {
  const start = Number.parseInt(startStr, 10);
  const end = Number.parseInt(endStr, 10);
  let step = stepStr === undefined ? 1 : Math.abs(Number.parseInt(stepStr, 10));

  if (step === 0) {
    step = 1;
  }

  const isZeroPadded =
    (startStr.length > 1 && startStr.startsWith("0")) ||
    (endStr.length > 1 && endStr.startsWith("0"));

  const width = Math.max(startStr.length, endStr.length);
  const count = Math.floor(Math.abs(end - start) / step) + 1;

  if (count > MAX_BRACE_ALTERNATIVES) {
    throw new Error(NAKAMA_STATE_REFUSAL);
  }

  const result: string[] = [];
  const dir = start <= end ? 1 : -1;
  const actualStep = step * dir;

  for (let val = start; dir > 0 ? val <= end : val >= end; val += actualStep) {
    let str = String(val);

    if (isZeroPadded && str.length < width && val >= 0) {
      str = str.padStart(width, "0");
    }

    result.push(str);
  }

  return result;
}

function expandCharSequence(
  startChar: string,
  endChar: string,
  stepStr?: string
): string[] {
  const start = startChar.charCodeAt(0);
  const end = endChar.charCodeAt(0);
  let step = stepStr === undefined ? 1 : Math.abs(Number.parseInt(stepStr, 10));

  if (step === 0) {
    step = 1;
  }

  const count = Math.floor(Math.abs(end - start) / step) + 1;

  if (count > MAX_BRACE_ALTERNATIVES) {
    throw new Error(NAKAMA_STATE_REFUSAL);
  }

  const result: string[] = [];
  const dir = start <= end ? 1 : -1;
  const actualStep = step * dir;

  for (let val = start; dir > 0 ? val <= end : val >= end; val += actualStep) {
    result.push(String.fromCharCode(val));
  }

  return result;
}

function expandBraceInner(inner: string): string[] | null {
  const numMatch = /^([+-]?\d+)\.\.([+-]?\d+)(?:\.\.([+-]?\d+))?$/.exec(inner);

  if (numMatch?.[1] && numMatch[2]) {
    return expandNumericSequence(numMatch[1], numMatch[2], numMatch[3]);
  }

  const charMatch = /^([a-zA-Z])\.\.([a-zA-Z])(?:\.\.([+-]?\d+))?$/.exec(inner);

  if (charMatch?.[1] && charMatch[2]) {
    return expandCharSequence(charMatch[1], charMatch[2], charMatch[3]);
  }

  if (inner.includes(",")) {
    return inner.split(",");
  }

  return null;
}

/**
 * Expand brace lists and sequences (`~/.nak{ma,x}/...`, `{8..8}`, `{a..z}`).
 * Capped at 1,000 alternatives to prevent denial-of-service stalls.
 */
function expandBraces(word: string): string[] {
  let current = [word];

  for (let depth = 0; depth < 8; depth += 1) {
    let hasMore = false;
    const next: string[] = [];

    for (const item of current) {
      const open = item.indexOf("{");

      if (open === -1) {
        next.push(item);
        continue;
      }

      const close = item.indexOf("}", open + 1);

      if (close === -1) {
        next.push(item);
        continue;
      }

      const inner = item.slice(open + 1, close);
      const alternatives = expandBraceInner(inner);

      if (!alternatives) {
        next.push(item);
        continue;
      }

      hasMore = true;
      const prefix = item.slice(0, open);
      const suffix = item.slice(close + 1);

      for (const alt of alternatives) {
        next.push(`${prefix}${alt}${suffix}`);

        if (next.length > MAX_BRACE_ALTERNATIVES) {
          throw new Error(NAKAMA_STATE_REFUSAL);
        }
      }
    }

    current = next;

    if (!hasMore) {
      break;
    }
  }

  return current;
}

/**
 * True when the glob word can name the scope root or anything under it. A word
 * whose leading segments equal an exempt workspace path is pinned there, so
 * its trailing globs can only name workspace files.
 */
function globWordReachesScope(
  word: string,
  scopeSegments: string[],
  exemptDirs: string[]
): boolean {
  const words = pathSegments(word);

  if (words.length < scopeSegments.length) {
    // A strict ancestor (or an unrelated path): the literal pass owns those.
    return false;
  }

  for (let index = 0; index < scopeSegments.length; index += 1) {
    if (!segmentMatches(words[index] ?? "", scopeSegments[index] ?? "")) {
      return false;
    }
  }

  for (const dir of exemptDirs) {
    const exemptSegments = pathSegments(dir);

    if (exemptSegments.length === 0 || words.length < exemptSegments.length) {
      continue;
    }

    let pinned = true;

    for (let index = 0; pinned && index < exemptSegments.length; index += 1) {
      pinned = words[index] === exemptSegments[index];
    }

    if (pinned) {
      return false;
    }
  }

  return true;
}

export function resolveHostBash(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
  which: (name: string) => string | null = Bun.which
): string {
  if (platform !== "win32") {
    const shell = exists("/bin/bash") ? "/bin/bash" : which("bash");

    if (shell) {
      return shell;
    }

    throw new Error("No Bash shell found. Install Bash and add it to PATH.");
  }

  for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"]]) {
    if (root) {
      // Use Bash itself, rather than Git's launcher, so its PID owns the tree.
      const shell = path.win32.join(root, "Git", "usr", "bin", "bash.exe");

      if (exists(shell)) {
        return shell;
      }
    }
  }

  const shell = which("bash.exe");

  // The WSL launcher uses a different filesystem and toolchain from the host.
  if (
    shell &&
    !/^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/i.test(
      shell.replaceAll("/", "\\")
    )
  ) {
    return shell;
  }

  throw new Error(
    "No native Bash shell found. Install Git for Windows (https://git-scm.com/download/win) or add a native Bash executable to PATH."
  );
}

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  envOverrides: Record<string, string> = {},
  options: ShellRunOptions
): Promise<BashOutput> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const env = mergeCodingAgentSpawnEnv(getToolExecutionEnv(), envOverrides);

    // A login shell may rebuild PATH from /etc/profile, as Debian in the Docker
    // image does. Put back the dirs the harness probe finds CLIs in, after the
    // profile's own so nothing that resolved before changes.
    const restorePath =
      process.platform !== "win32" && env.PATH
        ? 'PATH="$PATH:$NAKAMA_TOOL_PATH"; unset NAKAMA_TOOL_PATH; '
        : "";

    const child = spawn(resolveHostBash(), ["-lc", restorePath + command], {
      cwd,
      detached: process.platform !== "win32",
      env: restorePath ? { ...env, NAKAMA_TOOL_PATH: env.PATH } : env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutOverflow = false;
    let stderrOverflow = false;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let exited = false;
    let settled = false;
    let abortHandled = false;
    let treeKilled: Promise<void> | undefined;

    const killCommand = () => {
      treeKilled ??= killProcessTree(child, "SIGKILL");
    };

    const onAbort = () => {
      if (abortHandled) {
        return;
      }

      abortHandled = true;
      killCommand();
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (options.signal?.aborted) {
      onAbort();
    }

    const timeoutId = setTimeout(() => {
      timedOut = true;
      killCommand();
    }, timeoutMs);

    // A descendant may retain the pipes after the shell exits. Keep draining
    // active output, but release idle inherited handles like Pi does.
    const armExitTimer = () => {
      if (exited && !settled) {
        clearTimeout(exitTimer);
        exitTimer = setTimeout(
          () => finish(child.exitCode),
          EXIT_STDIO_GRACE_MS
        );
      }
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      armExitTimer();

      if (options.codingAgentMode) {
        const next = appendCodingAgentCapture(stdout, String(chunk));
        stdout = next.value;
        stdoutOverflow = stdoutOverflow || next.overflowed;

        return;
      }

      stdout = appendOutput(stdout, String(chunk));
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      armExitTimer();

      if (options.codingAgentMode) {
        const next = appendCodingAgentCapture(stderr, String(chunk));
        stderr = next.value;
        stderrOverflow = stderrOverflow || next.overflowed;

        return;
      }

      stderr = appendOutput(stderr, String(chunk));
    });

    async function finish(exitCode: number | null, error?: Error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      clearTimeout(exitTimer);
      options.signal?.removeEventListener("abort", onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      // The shell can exit before taskkill finishes terminating descendants.
      await treeKilled;

      if (error || abortHandled) {
        reject(
          error ?? new DOMException("The operation was aborted", "AbortError")
        );

        return;
      }

      void finalizeCodingAgentOutput({
        codingAgentMode: options.codingAgentMode,
        exitCode,
        stderr,
        stderrOverflow,
        stdout,
        stdoutOverflow,
        timedOut,
        workspaceRoot: options.workspaceRoot,
      })
        .then(resolve)
        .catch(reject);
    }

    child.once("error", (error) => finish(null, error));
    child.once("exit", () => {
      exited = true;
      armExitTimer();
    });
    child.once("close", (exitCode) => finish(exitCode));
  });
}

async function finalizeCodingAgentOutput(args: {
  codingAgentMode: boolean;
  workspaceRoot: string;
  stdout: string;
  stderr: string;
  stdoutOverflow: boolean;
  stderrOverflow: boolean;
  exitCode: number | null;
  timedOut: boolean;
}): Promise<BashOutput> {
  if (!args.codingAgentMode) {
    return {
      exitCode: args.exitCode,
      stderr: args.stderr,
      stdout: args.stdout,
      timedOut: args.timedOut,
    };
  }

  const logPath = await writeCodingAgentLog(
    args.workspaceRoot,
    args.stdout,
    args.stderr
  );

  let stdout = formatCodingAgentBashStdout(args.stdout, {
    exitCode: args.exitCode,
    logPath,
  });

  if (args.stdoutOverflow) {
    stdout = `${stdout}\n\n(stdout capture hit ${CODING_AGENT_MAX_CAPTURE_CHARS} char limit; see full log)`;
  }

  let stderr = keepTail(args.stderr, MAX_OUTPUT_CHARS);

  if (args.stderrOverflow) {
    stderr = `${stderr}\n\n(stderr capture hit ${CODING_AGENT_MAX_CAPTURE_CHARS} char limit; see full log)`;
  }

  return {
    exitCode: args.exitCode,
    stderr,
    stdout,
    timedOut: args.timedOut,
  };
}

async function writeCodingAgentLog(
  workspaceRoot: string,
  stdout: string,
  stderr: string
): Promise<string | null> {
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error(
      "workspaceRoot must be an absolute path; relative roots resolve against process.cwd() and break profile isolation."
    );
  }

  try {
    const dir = path.join(workspaceRoot, "artifacts", "coding-agent-runs");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${stamp}-${Math.random().toString(36).slice(2, 8)}.log`;
    const absolutePath = path.join(dir, fileName);

    const body = [
      "=== stdout ===",
      stdout,
      "",
      "=== stderr ===",
      stderr,
      "",
    ].join("\n");

    await writeFile(absolutePath, body, "utf8");
    await pruneCodingAgentLogs(dir);

    return path.join("artifacts", "coding-agent-runs", fileName);
  } catch {
    return null;
  }
}

async function pruneCodingAgentLogs(dir: string): Promise<void> {
  const names = await readdir(dir);
  const logs = names.filter((name) => name.endsWith(".log"));

  if (logs.length <= CODING_AGENT_LOG_RETENTION) {
    return;
  }

  const ranked = await Promise.all(
    logs.map(async (name) => {
      try {
        const info = await stat(path.join(dir, name));

        return { mtimeMs: info.mtimeMs, name };
      } catch {
        return { mtimeMs: 0, name };
      }
    })
  );

  ranked.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1));

  for (const stale of ranked.slice(CODING_AGENT_LOG_RETENTION)) {
    await unlink(path.join(dir, stale.name)).catch(() => undefined);
  }
}

function appendOutput(current: string, chunk: string): string {
  const combined = current + chunk;

  if (combined.length <= MAX_OUTPUT_CHARS) {
    return combined;
  }

  return combined.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]";
}

interface CodingAgentCapture {
  overflowed: boolean;
  value: string;
}

function appendCodingAgentCapture(
  current: string,
  chunk: string
): CodingAgentCapture {
  if (current.length >= CODING_AGENT_MAX_CAPTURE_CHARS) {
    return { overflowed: true, value: current };
  }

  const remaining = CODING_AGENT_MAX_CAPTURE_CHARS - current.length;

  if (chunk.length <= remaining) {
    return { overflowed: false, value: current + chunk };
  }

  return {
    overflowed: true,
    value: current + chunk.slice(0, remaining),
  };
}

function keepTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `...[truncated]\n${value.slice(value.length - maxChars)}`;
}

async function resolveWorkspaceRoot(rawWorkspaceRoot: string): Promise<string> {
  if (!path.isAbsolute(rawWorkspaceRoot)) {
    throw new Error(
      "workspaceRoot must be an absolute path; relative roots resolve against process.cwd() and break profile isolation."
    );
  }

  try {
    return await realpath(rawWorkspaceRoot);
  } catch {
    return rawWorkspaceRoot;
  }
}

function readTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(value, MAX_TIMEOUT_MS);
}
