import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredSkill, ToolDefinition } from "@nakama/core";
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
          bin: resolvePythonBin(),
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
        bin: resolvePythonBin(),
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

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
