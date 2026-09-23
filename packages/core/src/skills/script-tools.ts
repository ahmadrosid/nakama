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
  if (!/\bdef\s+run\s*\(/.test(source)) {
    return "defines no run(input, context) function";
  }
  const hasHarness =
    /if\s+__name__\s*==\s*["']__main__["']\s*:/.test(source) &&
    source.includes("sys.stdin") &&
    source.includes("sys.stdout");

  return hasHarness ? null : "has no __main__ JSON stdin/stdout harness";
}

/** First line of a Python module docstring, used as the tool description. */
function pythonDocstring(source: string): string {
  const match = source.match(/^\s*("""|''')([^\n]*)/u);
  const line = match?.[2] ?? "";
  // A one line docstring closes on the same line, so drop the trailing quotes.
  return line.replace(/("""|''')\s*$/u, "").trim();
}

function toolNameFor(skillName: string, scriptPath: string): string {
  const stem = path.basename(scriptPath).replace(/\.[^.]+$/u, "");
  const slug = stem.replace(/[^a-zA-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  return slug ? `${skillName}_${slug}` : skillName;
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
    const base = path.basename(script);
    if (base === SKILL_FILE_NAME) {
      continue;
    }
    issues.push({
      path: path.relative(input.directory, script),
      reason: `not runnable: name it one of ${SKILL_TOOL_FILES.join(", ")} at the skill root, or list it under "scripts:" in ${SKILL_FILE_NAME}`,
    });
  }

  return { issues, tools };
}
