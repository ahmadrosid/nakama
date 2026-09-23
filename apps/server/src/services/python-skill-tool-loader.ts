import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredSkill, ToolDefinition } from "@nakama/core";
import { spawnJsonTool } from "./custom-tool-subprocess";
import { resolvePythonBin } from "./python-tool-loader";

export async function loadPythonSkillTool(
  skill: DiscoveredSkill,
  script?: { description: string; name: string; path: string }
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
    if (
      !(
        /if\s+__name__\s*==\s*["']__main__["']\s*:/.test(source) &&
        source.includes("sys.stdin") &&
        source.includes("sys.stdout")
      )
    ) {
      throw new Error(
        "Python skill tool must include a JSON stdin/stdout harness."
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
          cwd: path.dirname(modulePath),
          input,
          label: "Python skill tool",
          workspaceRoot:
            typeof context.workspaceRoot === "string"
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
