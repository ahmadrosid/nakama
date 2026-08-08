import path from "node:path";
import { pathToFileURL } from "node:url";
import type { JsonSchema, ToolContext, ToolDefinition } from "../contract";
import { permissiveObjectSchema } from "../tools/schema";
import type { DiscoveredSkill } from "./types";

const moduleCache = new Map<string, SkillToolModule>();

interface SkillToolModule {
  description?: string;
  name?: string;
  parameters?: JsonSchema;
  run: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export async function loadSkillTool(
  skill: DiscoveredSkill
): Promise<ToolDefinition | null> {
  if (!skill.toolPath) {
    return null;
  }

  try {
    const module = await importSkillToolModule(skill.toolPath);

    return {
      description: module.description?.trim() || skill.description,
      name: module.name?.trim() || skill.name,
      parameters: module.parameters ?? permissiveObjectSchema(),
      async run(input, context) {
        return module.run(input, context);
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      description: skill.description,
      name: skill.name,
      parameters: permissiveObjectSchema(),
      async run() {
        return { error: `Skill tool failed to load: ${message}` };
      },
    };
  }
}

export async function loadSkillTools(
  skills: DiscoveredSkill[]
): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];

  for (const skill of skills) {
    if (!skill.hasTool) {
      continue;
    }

    const tool = await loadSkillTool(skill);

    if (tool) {
      tools.push(tool);
    }
  }

  return tools;
}

function resolveSkillToolPath(
  toolPath: string,
  skillDirectory: string
): string {
  const resolved = path.isAbsolute(toolPath)
    ? path.resolve(toolPath)
    : path.resolve(skillDirectory, toolPath);

  if (!isPathInsideDirectory(resolved, skillDirectory)) {
    throw new Error(`Skill tool path must stay inside ${skillDirectory}.`);
  }

  return resolved;
}

async function importSkillToolModule(
  modulePath: string
): Promise<SkillToolModule> {
  const cached = moduleCache.get(modulePath);

  if (cached) {
    return cached;
  }

  const imported = await import(pathToFileURL(modulePath).href);
  const module = normalizeSkillToolModule(imported);
  moduleCache.set(modulePath, module);
  return module;
}

function normalizeSkillToolModule(imported: unknown): SkillToolModule {
  if (typeof imported !== "object" || imported === null) {
    throw new Error("Skill tool module must export a run function.");
  }

  const record = imported as Record<string, unknown>;
  const defaultExport =
    typeof record.default === "object" && record.default !== null
      ? (record.default as Record<string, unknown>)
      : null;
  const source = defaultExport ?? record;
  const run = source.run;

  if (typeof run !== "function") {
    throw new Error("Skill tool module must export a run function.");
  }

  return {
    description:
      typeof source.description === "string" ? source.description : undefined,
    name: typeof source.name === "string" ? source.name : undefined,
    parameters: isJsonSchema(source.parameters) ? source.parameters : undefined,
    run: (input, context) => Promise.resolve(run(input, context)),
  };
}

function isPathInsideDirectory(
  targetPath: string,
  directoryPath: string
): boolean {
  const relative = path.relative(directoryPath, targetPath);
  return (
    relative === "" || !(relative.startsWith("..") || path.isAbsolute(relative))
  );
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null;
}

export function clearSkillToolModuleCache(): void {
  moduleCache.clear();
}

export { resolveSkillToolPath };
