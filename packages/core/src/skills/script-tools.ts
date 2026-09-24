import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../fs";
import { SKILL_FILE_NAME, SKILL_TOOL_FILES } from "./paths";

/** Extensions a skill can ship that some loader might be able to run. */
const SCRIPT_EXTENSIONS = [".py", ".js", ".ts", ".mjs"] as const;

export interface SkillScriptTool {
  description: string;
  name: string;
  path: string;
}

/**
 * A script the skill ships that no loader will reach, with the reason.
 *
 * These used to be invisible: the skill installs, the catalog shows it, and the
 * agent reads the script as prose. It then answers from the prompt text, which
 * looks like a correct answer and is not one.
 */
export interface SkillScriptIssue {
  path: string;
  reason: string;
}

/**
 * Python tools talk JSON over stdin and stdout, so a script without that
 * harness loads as an error stub the author only sees from inside a tool
 * result. Checked here instead, while the skill is being discovered.
 */
function describePythonHarnessGap(source: string): string | null {
  // Both gaps at once. Reporting only the first costs the author a second
  // discovery pass to learn about the second, for one edit they could have
  // made together: a module written without this contract in mind usually has
  // neither piece.
  const gaps: string[] = [];
  if (!/\bdef\s+run\s*\(/.test(source)) {
    gaps.push("defines no run(input, context) function");
  }
  // Only the input half is checked. `print(json.dumps(...))` writes to stdout
  // without naming it, so requiring the string `sys.stdout` rejected working
  // scripts, and the runner reports a silent tool accurately on its own.
  const hasHarness =
    /if\s+__name__\s*==\s*["']__main__["']\s*:/.test(source) &&
    source.includes("sys.stdin");
  if (!hasHarness) {
    gaps.push("has no __main__ block reading sys.stdin");
  }

  return gaps.length > 0 ? gaps.join(", and ") : null;
}

/** Summary line of a Python module docstring, used as the tool description. */
function pythonDocstring(source: string): string {
  const match = source.match(/^\s*("""|''')([\s\S]*?)(?:\1|$)/u);
  const body = match?.[2] ?? "";
  // PEP 257 puts the summary on the opening line for a one line docstring and
  // on the line below it for a multi line one, and formatters leave both
  // alone. Reading only the opening line gave an empty description to every
  // module written the second way, which hands the model a tool name and
  // nothing about what it does.
  const summary = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return summary ?? "";
}

/** Providers accept [A-Za-z0-9_-] in a function name, up to 64 characters. */
const TOOL_NAME_LIMIT = 64;

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
}

/**
 * Modules a script imports that ship with Python. Anything outside this set
 * has to be installed in the runtime, and a script that imports it loads as a
 * tool and then fails on its first call, which is the spot this file exists to
 * move failures out of.
 */
const PYTHON_STDLIB = new Set([
  "abc",
  "argparse",
  "ast",
  "asyncio",
  "base64",
  "binascii",
  "bisect",
  "calendar",
  "cmath",
  "collections",
  "configparser",
  "contextlib",
  "copy",
  "csv",
  "ctypes",
  "dataclasses",
  "datetime",
  "decimal",
  "difflib",
  "enum",
  "fnmatch",
  "fractions",
  "functools",
  "glob",
  "gzip",
  "hashlib",
  "heapq",
  "hmac",
  "html",
  "http",
  "importlib",
  "inspect",
  "io",
  "ipaddress",
  "itertools",
  "json",
  "logging",
  "math",
  "mimetypes",
  "numbers",
  "operator",
  "os",
  "pathlib",
  "pickle",
  "platform",
  "pprint",
  "queue",
  "random",
  "re",
  "secrets",
  "shlex",
  "shutil",
  "signal",
  "sqlite3",
  "statistics",
  "string",
  "struct",
  "subprocess",
  "sys",
  "tempfile",
  "textwrap",
  "threading",
  "time",
  "tomllib",
  "traceback",
  "types",
  "typing",
  "unicodedata",
  "unittest",
  "urllib",
  "uuid",
  "warnings",
  "weakref",
  "xml",
  "zipfile",
  "zlib",
]);

/** Top level packages a script imports that are not part of Python itself. */
function thirdPartyImports(source: string): string[] {
  const found = new Set<string>();
  for (const line of source.split("\n")) {
    const match = line.match(
      /^\s*(?:import\s+([A-Za-z_][\w.]*)|from\s+([A-Za-z_][\w.]*)\s+import\b)/u
    );
    const root = (match?.[1] ?? match?.[2] ?? "").split(".")[0];
    if (root && !PYTHON_STDLIB.has(root)) {
      found.add(root);
    }
  }
  return [...found].sort();
}

function toolNameFor(skillName: string, scriptPath: string): string {
  const stem = slugify(path.basename(scriptPath).replace(/\.[^.]+$/u, ""));
  // The skill name is slugified too. It reached the tool name untouched
  // before, so a skill named with a space or a dot produced a name providers
  // reject, and the skill looked installed right up to the first call.
  const skill = slugify(skillName);
  const name = stem ? `${skill}_${stem}` : skill;
  if (name.length <= TOOL_NAME_LIMIT) {
    return name;
  }
  // Trim the skill half, never the file half: the file is what tells two tools
  // of the same skill apart, and cutting it back would collide them.
  const room = TOOL_NAME_LIMIT - stem.length - 1;
  return room > 0
    ? `${skill.slice(0, room).replace(/_+$/u, "")}_${stem}`
    : stem.slice(0, TOOL_NAME_LIMIT);
}

async function listSkillScripts(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3) {
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
          await walk(full, depth + 1);
        }
      } else if (
        SCRIPT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ) {
        found.push(full);
      }
    }
  };
  await walk(directory, 0);
  return found.sort();
}

/**
 * Resolves the scripts a skill declares in `scripts:` into callable tools, and
 * reports every shipped script that nothing will run.
 */
export async function resolveSkillScripts(input: {
  declared: string[];
  directory: string;
  skillName: string;
  toolPath: string | null;
}): Promise<{ issues: SkillScriptIssue[]; tools: SkillScriptTool[] }> {
  const issues: SkillScriptIssue[] = [];
  const tools: SkillScriptTool[] = [];
  const reachable = new Set<string>(input.toolPath ? [input.toolPath] : []);

  for (const relative of input.declared) {
    const segments = relative.split(/[/\\]+/u).filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === "..")) {
      issues.push({
        path: relative,
        reason: "path cannot contain '.' or '..' segments",
      });
      continue;
    }
    const full = path.join(input.directory, ...segments);
    if (!(await pathExists(full))) {
      issues.push({ path: relative, reason: "declared but not in the skill" });
      continue;
    }
    if (!full.endsWith(".py")) {
      issues.push({
        path: relative,
        reason: "only .py scripts can be declared today",
      });
      continue;
    }
    const source = await readFile(full, "utf8");
    const gap = describePythonHarnessGap(source);
    if (gap) {
      issues.push({ path: relative, reason: gap });
      continue;
    }
    reachable.add(full);
    const third = thirdPartyImports(source);
    if (third.length > 0) {
      // Not a failure, a dependency the runtime may not carry. Said here so the
      // author hears it at discovery rather than from inside a tool result on
      // the first call.
      issues.push({
        path: relative,
        reason: `needs ${third.join(", ")} installed in the Python runtime; nothing here checks that it is`,
      });
    }
    tools.push({
      description: pythonDocstring(source) || `${input.skillName}: ${relative}`,
      name: toolNameFor(input.skillName, relative),
      path: full,
    });
  }

  for (const script of await listSkillScripts(input.directory)) {
    if (reachable.has(script)) {
      continue;
    }
    issues.push({
      path: path.relative(input.directory, script),
      reason: `not runnable: name it one of ${SKILL_TOOL_FILES.join(", ")} at the skill root, or list it under "scripts:" in ${SKILL_FILE_NAME}`,
    });
  }

  return { issues, tools };
}
