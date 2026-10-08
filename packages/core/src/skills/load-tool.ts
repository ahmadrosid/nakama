import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { JsonSchema, ToolContext, ToolDefinition } from "../contract";
import { getPluginsRootDir } from "../plugins";
import { permissiveObjectSchema } from "../tools/schema";
import type { DiscoveredSkill } from "./types";

const moduleCache = new Map<string, SkillToolModule>();

const JsonValueSchema = z.json();

const SkillToolModuleSchema = z.object({
  description: z.string().optional(),
  name: z.string().optional(),
  parameters: z.record(z.string(), JsonValueSchema).optional(),
  run: z
    .function()
    .input([JsonValueSchema, z.custom<ToolContext>()])
    .output(z.promise(z.union([JsonValueSchema, z.undefined()]))),
});

const ImportedSkillModuleSchema = z
  .object({ default: z.unknown().optional() })
  .passthrough();

type JsonValue = z.infer<typeof JsonValueSchema>;

interface SkillToolModule {
  description?: string;
  name?: string;
  parameters?: JsonSchema;
  run: (
    input: JsonValue,
    context: ToolContext
  ) => Promise<JsonValue | undefined>;
}

export async function loadSkillTool(
  skill: DiscoveredSkill
): Promise<ToolDefinition | null> {
  if (!skill.toolPath) {
    return null;
  }

  if (
    isPluginSkillToolPath(skill.toolPath) ||
    isPluginSkillToolPath(skill.directory)
  ) {
    return {
      description: skill.description,
      name: skill.name,
      parameters: permissiveObjectSchema(),
      async run() {
        return {
          error: "Plugin skill entrypoints cannot be loaded in-process.",
        };
      },
    };
  }

  try {
    const module = await importSkillToolModule(skill.toolPath);

    return {
      description: module.description?.trim() || skill.description,
      name: module.name?.trim() || skill.name,
      parameters: module.parameters ?? permissiveObjectSchema(),
      async run(input, context) {
        return module.run(JsonValueSchema.parse(input), context);
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

function normalizeSkillToolModule<Imported>(
  imported: Imported
): SkillToolModule {
  const record = ImportedSkillModuleSchema.safeParse(imported);

  if (!record.success) {
    throw new Error("Skill tool module must export a run function.");
  }

  const defaultModule = SkillToolModuleSchema.safeParse(record.data.default);

  const module = defaultModule.success
    ? defaultModule
    : SkillToolModuleSchema.safeParse(record.data);

  if (!module.success) {
    throw new Error(
      "Skill tool module must export a run function with JSON results."
    );
  }

  const parameters = module.data.parameters;

  return {
    description: module.data.description,
    name: module.data.name,
    // SAFETY: This schema parse confirms parameters are a JSON object before exposing them as JSON Schema.
    parameters: parameters as JsonSchema | undefined,
    run: (input, context) => module.data.run(input, context),
  };
}

function isPluginSkillToolPath(filePath: string): boolean {
  try {
    const root = resolve(getPluginsRootDir());
    const resolved = resolve(filePath);

    return resolved === root || resolved.startsWith(`${root}${sep}`);
  } catch {
    return false;
  }
}
