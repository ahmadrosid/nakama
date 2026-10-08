import { z } from "zod";
import type {
  JsonSchema,
  LlmToolDefinition,
  ToolDefinition,
} from "../contract";
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT } from "./ripgrep";

export function emptyObjectSchema(): JsonSchema {
  return {
    additionalProperties: false,
    properties: {},
    type: "object",
  };
}

export function permissiveObjectSchema(): JsonSchema {
  return {
    additionalProperties: true,
    type: "object",
  };
}

export function toLlmToolDefinition(tool: ToolDefinition): LlmToolDefinition {
  return {
    description: tool.description,
    name: tool.name,
    parameters: tool.parameters ?? emptyObjectSchema(),
  };
}

export function toLlmToolDefinitions(
  tools: ToolDefinition[]
): LlmToolDefinition[] {
  return tools.map(toLlmToolDefinition);
}

export function jsonSchemaFromZod(schema: z.ZodType): JsonSchema {
  const { $schema, ...jsonSchema } = schema.toJSONSchema();

  // SAFETY: Zod emits a valid JSON Schema object before this owner contract narrows its type.
  return jsonSchema as JsonSchema;
}

export function parseToolInput<T, Input>(
  schema: z.ZodType<T>,
  input: Input
): T {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues[0]?.message ?? "Invalid tool input.");
    }

    throw err;
  }
}

export function requiredTrimmedString(field: string) {
  return z
    .string({ error: `${field} is required.` })
    .trim()
    .min(1, `${field} is required.`);
}

export const trimmedOptionalString = z
  .string()
  .trim()
  .min(1)
  .optional()
  .catch(undefined);

export const maxResultsSchema = z
  .number()
  .finite()
  .transform(Math.floor)
  .pipe(z.number().int().positive().max(MAX_RESULTS_LIMIT))
  .catch(DEFAULT_MAX_RESULTS)
  .default(DEFAULT_MAX_RESULTS);

export const optionalRegexFlag = z
  .boolean()
  .optional()
  .default(true)
  .catch(true);

export const readFileOffsetSchema = z
  .number()
  .int()
  .positive()
  .catch(1)
  .default(1);

export const readFileLimitSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .catch(undefined);
