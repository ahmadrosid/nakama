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
  return jsonSchema as JsonSchema;
}

export function parseToolInput<T>(schema: z.ZodType<T>, input: unknown): T {
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

export const trimmedOptionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined,
  z.string().optional()
);

export const maxResultsSchema = z.preprocess((value) => {
  if (value === undefined) {
    return DEFAULT_MAX_RESULTS;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(normalized, MAX_RESULTS_LIMIT);
}, z.number().int().positive().max(MAX_RESULTS_LIMIT));

export const optionalRegexFlag = z.preprocess(
  (value) => (typeof value === "boolean" ? value : undefined),
  z.boolean().optional().default(true)
);

export const readFileOffsetSchema = z.preprocess((value) => {
  if (value === undefined) {
    return 1;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return 1;
  }
  return value;
}, z.number().int().positive());

export const readFileLimitSchema = z.preprocess((value) => {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return;
  }
  return value;
}, z.number().int().positive().optional());
