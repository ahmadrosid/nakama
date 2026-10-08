import {
  type GenerateContentConfig,
  ThinkingLevel,
  type Tool,
} from "@google/genai";
import type {
  GenerateChatInput,
  LlmToolDefinition,
  ProviderChatOptions,
  ThinkingEffort,
} from "@nakama/core";
import { z } from "zod";
import {
  normalizeThinkingEffort,
  type ProviderJsonRecord,
  type ProviderJsonValue,
  readProviderNumber,
  readProviderString,
  readRecord,
} from "../shared";

export function buildGeminiGenerateConfig(options: {
  system: string;
  tools?: LlmToolDefinition[];
  providerOptions?: ProviderChatOptions;
  model: string;
  responseMimeType?: string;
}): GenerateContentConfig {
  const tools = buildGeminiTools(
    options.tools,
    options.providerOptions?.webSearch ?? false
  );

  const thinkingConfig = buildGeminiThinkingConfig(
    options.model,
    options.providerOptions
  );

  const config: GenerateContentConfig = {
    systemInstruction: options.system,
  };

  if (options.responseMimeType) {
    config.responseMimeType = options.responseMimeType;
  }

  if (tools) {
    config.tools = tools;
  }

  if (thinkingConfig) {
    config.thinkingConfig = thinkingConfig;
  }

  return config;
}

// Gemini function declarations accept a subset of JSON Schema: exclusive bounds
// and the $schema marker are rejected with 400 INVALID_ARGUMENT, and Zod emits
// exclusiveMinimum for .positive(). Translate to the closest supported bound.
const DROPPED_SCHEMA_KEYS = new Set([
  "$schema",
  "exclusiveMaximum",
  "exclusiveMinimum",
]);

function inclusiveBoundFor(
  schema: ProviderJsonRecord,
  exclusiveValue: number,
  step: number
): number {
  return readProviderString(schema.type) === "integer"
    ? exclusiveValue + step
    : exclusiveValue;
}

function applyExclusiveBound(
  target: ProviderJsonRecord,
  source: ProviderJsonRecord,
  exclusiveKey: "exclusiveMaximum" | "exclusiveMinimum",
  inclusiveKey: "maximum" | "minimum",
  step: number
): void {
  const exclusiveValue = readProviderNumber(source[exclusiveKey]);

  if (exclusiveValue === undefined || inclusiveKey in target) {
    return;
  }

  target[inclusiveKey] = inclusiveBoundFor(source, exclusiveValue, step);
}

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

function sanitizeSchemaValue<Value>(value: Value): ProviderJsonValue {
  if (Array.isArray(value)) {
    return value.map(sanitizeSchemaValue);
  }

  if (value === null) {
    return null;
  }

  if (!(value instanceof Object)) {
    const parsed = jsonPrimitiveSchema.safeParse(value);

    return parsed.success ? parsed.data : null;
  }

  const source = readRecord(value);
  const sanitized: ProviderJsonRecord = {};

  for (const [key, entry] of Object.entries(source)) {
    if (DROPPED_SCHEMA_KEYS.has(key)) {
      continue;
    }

    sanitized[key] = sanitizeSchemaValue(entry);
  }

  applyExclusiveBound(sanitized, source, "exclusiveMinimum", "minimum", 1);
  applyExclusiveBound(sanitized, source, "exclusiveMaximum", "maximum", -1);

  return sanitized;
}

export function sanitizeGeminiToolParameters(
  parameters: LlmToolDefinition["parameters"]
): LlmToolDefinition["parameters"] {
  const sanitized = sanitizeSchemaValue(parameters);

  // SAFETY: The input is the core-owned JSON Schema contract, sanitized recursively above.
  return sanitized as LlmToolDefinition["parameters"];
}

function buildGeminiTools(
  tools: LlmToolDefinition[] | undefined,
  webSearch: boolean
): Tool[] | undefined {
  const result: Tool[] = [];

  if (webSearch) {
    result.push({ googleSearch: {} });
  }

  if (tools?.length) {
    result.push({
      functionDeclarations: tools.map((tool) => ({
        description: tool.description,
        name: tool.name,
        parameters: sanitizeGeminiToolParameters(tool.parameters),
      })),
    });
  }

  return result.length > 0 ? result : undefined;
}

function buildGeminiThinkingConfig(
  model: string,
  providerOptions: ProviderChatOptions | undefined
): GenerateContentConfig["thinkingConfig"] {
  const enabled = providerOptions?.thinking?.enabled ?? false;

  if (!enabled) {
    if (model.includes("flash")) {
      return { thinkingBudget: 0 };
    }

    return;
  }

  const effort = normalizeThinkingEffort(providerOptions?.thinking?.effort);

  if (model.includes("gemini-3") || model.includes("3-")) {
    return {
      includeThoughts: true,
      thinkingLevel: mapEffortToThinkingLevel(effort),
    };
  }

  return {
    includeThoughts: true,
    thinkingBudget: mapEffortToThinkingBudget(effort),
  };
}

function mapEffortToThinkingLevel(effort: ThinkingEffort): ThinkingLevel {
  if (effort === "low") {
    return ThinkingLevel.LOW;
  }

  if (effort === "high") {
    return ThinkingLevel.HIGH;
  }

  return ThinkingLevel.MEDIUM;
}

function mapEffortToThinkingBudget(effort: ThinkingEffort): number {
  if (effort === "low") {
    return 1024;
  }

  if (effort === "high") {
    return 8192;
  }

  return 4096;
}

export function buildGeminiChatConfig(
  input: Pick<GenerateChatInput, "tools" | "providerOptions">,
  system: string,
  model: string
): GenerateContentConfig {
  return buildGeminiGenerateConfig({
    model,
    providerOptions: input.providerOptions,
    system,
    tools: input.tools,
  });
}
