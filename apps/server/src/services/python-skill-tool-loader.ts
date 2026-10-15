import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredSkill, ToolDefinition } from "@nakama/core";
import {
  getSkillPythonEnvBin,
  getSkillPythonEnvDir,
  NakamaApiError,
  pathExists,
  SKILL_REQUIREMENTS_FILE,
} from "@nakama/core";
import { spawnJsonTool } from "./custom-tool-subprocess";
import { resolvePythonBin } from "./python-tool-loader";

export interface PythonSkillToolOptions {
  /**
   * Whether the child may be told where the deployment keeps its configuration
   * and secret store. Only server-shipped skills get that: a profile's own
   * skills are member-authored, and handing one the config dir hands it every
   * org's API keys and workspace on the host. The default is the safe one.
   */
  exposeConfigDir?: boolean;
  /** Shared code runs relative to the executing team workspace. */
  useWorkspaceCwd?: boolean;
}

export async function loadPythonSkillTool(
  skill: DiscoveredSkill,
  script?: { description: string; name: string; path: string },
  options: PythonSkillToolOptions = {}
): Promise<ToolDefinition | null> {
  const modulePath = script?.path ?? skill.toolPath;
  const toolName = script?.name ?? skill.name;
  const toolDescription = script?.description ?? skill.description;

  if (!modulePath?.endsWith(".py")) {
    return null;
  }

  try {
    const source = await readFile(modulePath, "utf8");

    if (!/\bdef\s+run\s*\(/.test(source)) {
      throw new Error("Python skill tool must define run(input, context).");
    }

    // No check on how the result is written. `print(json.dumps(...))` is the
    // ordinary way to reach stdout in Python and a substring search for
    // `sys.stdout` refused it, claiming a harness was missing from a file that
    // had one. spawnJsonTool answers the same question truthfully at run time:
    // "produced no output; it must print its JSON result to stdout".
    if (
      !(
        /if\s+__name__\s*==\s*["']__main__["']\s*:/.test(source) &&
        source.includes("sys.stdin")
      )
    ) {
      throw new Error(
        "Python skill tool must read its JSON input from sys.stdin inside a __main__ block."
      );
    }

    return {
      description: toolDescription,
      name: toolName,
      parameters: { additionalProperties: true, type: "object" },
      async run(input, context) {
        return spawnJsonTool({
          args: [modulePath],
          bin: skillPythonBin(skill.directory),
          context,
          cwd: options.useWorkspaceCwd
            ? (context.workspaceRoot ?? path.dirname(modulePath))
            : path.dirname(modulePath),
          input,
          label: "Python skill tool",
          transport: { includeConfigDir: options.exposeConfigDir === true },
          workspaceRoot: isString(context.workspaceRoot)
            ? context.workspaceRoot
            : undefined,
        });
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      description: toolDescription,
      name: toolName,
      parameters: { additionalProperties: true, type: "object" },
      async run() {
        return { error: `Python skill tool failed to load: ${message}` };
      },
    };
  }
}

// Prints are captured so a module's own output reaches the model as text
// without the module knowing about the JSON transport.
const RUNNER_SOURCE = `import contextlib, io, json, sys
sys.path.insert(0, sys.argv[1])
out = io.StringIO()
with contextlib.redirect_stdout(out):
    exec(compile(json.load(sys.stdin)["code"], "<code>", "exec"), {"__name__": "__nakama__"})
print(json.dumps({"stdout": out.getvalue()}))`;

/**
 * Claude Code skills ship plain modules (functions plus a demo `__main__`) that
 * no `run(input, context)` harness reaches. This tool runs model-written code
 * with the skill directory first on `sys.path`, so the caller decides who gets
 * it: it is arbitrary host code, exactly as much as `bash` is.
 */
export function createPythonSkillRunner(
  skill: DiscoveredSkill
): ToolDefinition | null {
  const reached = new Set([
    skill.toolPath,
    ...skill.scriptTools.map((script) => script.path),
  ]);

  // Only skills that ship Python nothing else runs. A skill whose scripts all
  // load through tool.py or `scripts:` keeps exactly the tools it had.
  if (
    !skill.scriptIssues.some(
      (issue) =>
        issue.path.endsWith(".py") &&
        !reached.has(path.join(skill.directory, issue.path))
    )
  ) {
    return null;
  }

  return {
    description: `Run Python against the modules shipped with the "${skill.name}" skill (${skill.description}). The skill directory is first on sys.path, so import its modules by name and call their functions. Pass {"code": "..."}; whatever the code prints comes back as stdout.`,
    name: `${skill.name.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 53)}_run_python`,
    parameters: {
      additionalProperties: false,
      properties: { code: { type: "string" } },
      required: ["code"],
      type: "object",
    },
    async run(input, context) {
      // SAFETY: Checked as a string before use; anything else is refused.
      const code = (input as { code?: unknown } | null)?.code;

      if (!isString(code)) {
        return { error: 'Pass the Python to run as {"code": "..."}.' };
      }

      const workspaceRoot = isString(context.workspaceRoot)
        ? context.workspaceRoot
        : undefined;

      return spawnJsonTool({
        args: ["-c", RUNNER_SOURCE, skill.directory],
        bin: skillPythonBin(skill.directory),
        context,
        cwd: workspaceRoot ?? skill.directory,
        input: { code },
        label: "Python skill runner",
        // Model-written code never learns where the secret store is, even
        // for a server-shipped skill.
        transport: { includeConfigDir: false },
        workspaceRoot,
      });
    },
  };
}

/** The skill's own environment once an admin has installed it, else the server's. */
export function skillPythonBin(skillDirectory: string): string {
  const bin = getSkillPythonEnvBin(skillDirectory);

  return existsSync(bin) ? bin : resolvePythonBin();
}

const INSTALL_TIMEOUT_MS = 10 * 60_000;

/**
 * Builds the skill's environment and installs its requirements.txt into it.
 * Only ever called from an explicit admin action: pip runs package build code
 * on the host, so this is at least as privileged as running the skill.
 */
export async function installSkillPythonPackages(
  skillDirectory: string
): Promise<{ output: string }> {
  const requirements = path.join(skillDirectory, SKILL_REQUIREMENTS_FILE);

  if (!(await pathExists(requirements))) {
    throw new NakamaApiError(
      `This skill has no ${SKILL_REQUIREMENTS_FILE}.`,
      400
    );
  }

  const python = getSkillPythonEnvBin(skillDirectory);
  let output = "";

  if (!existsSync(python)) {
    output += await runInstallStep(resolvePythonBin(), [
      "-m",
      "venv",
      getSkillPythonEnvDir(skillDirectory),
    ]);
  }

  output += await runInstallStep(python, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--no-input",
    "-r",
    requirements,
  ]);

  return { output: output.slice(-4000) };
}

function runInstallStep(bin: string, args: string[]): Promise<string> {
  // The server's own env carries provider keys, and package build scripts run
  // here, so pip gets only PATH and the proxy settings it needs to download.
  const env: NodeJS.ProcessEnv = { PIP_NO_CACHE_DIR: "1" };

  for (const name of ["PATH", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]) {
    const value = process.env[name] ?? process.env[name.toLowerCase()];

    if (value) {
      env[name] = value;
    }
  }

  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { env, maxBuffer: 10_000_000, timeout: INSTALL_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new NakamaApiError(
              `Installing Python packages failed: ${`${stderr}${stdout}`.slice(-2000) || error.message}`,
              422
            )
          );

          return;
        }

        resolve(`${stdout}${stderr}`);
      }
    );
  });
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
