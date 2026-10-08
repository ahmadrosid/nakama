import { z } from "zod";
import type { CustomModelEntry, WireApi } from "./contract";

const JsonValueSchema = z.json();

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const DISPLAY_NAME_MAX_LENGTH = 64;

/**
 * Endpoints that serve `/responses` have to be told apart from the ones that
 * serve `/chat/completions`, and the model id does not say which is which.
 * Anything unrecognised stays on chat, so a bad value cannot take an endpoint
 * offline.
 */
export function parseWireApi<Value>(value: Value): WireApi | undefined {
  const parsed = z.literal("responses").safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function isValidBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl.trim());

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateDisplayName(displayName: string): string {
  const trimmed = displayName.trim();

  if (!trimmed) {
    throw new Error("Provider name is required.");
  }

  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(
      `Provider name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`
    );
  }

  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error("Provider name contains invalid characters.");
  }

  return trimmed;
}

export function parseCustomModelsJson(
  raw: string | undefined
): CustomModelEntry[] | undefined {
  if (!raw?.trim()) {
    return;
  }

  let parsed: z.infer<typeof JsonValueSchema>;

  try {
    parsed = JsonValueSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("Invalid models_json in config.");
  }

  const entries = z.array(JsonObjectSchema).safeParse(parsed);

  if (!entries.success) {
    throw new Error("models_json must be a JSON array.");
  }

  return validateCustomModels(entries.data);
}

export function validateCustomModels<Entries>(
  entries: Entries
): CustomModelEntry[] {
  const parsedEntries = z.array(JsonObjectSchema).safeParse(entries);

  if (!parsedEntries.success || parsedEntries.data.length === 0) {
    throw new Error("At least one model is required.");
  }

  const result: CustomModelEntry[] = [];
  let defaultCount = 0;

  for (const record of parsedEntries.data) {
    const id = z.string().safeParse(record.id).data?.trim() ?? "";

    if (!id) {
      throw new Error("Each model must have a non-empty id.");
    }

    const name = z.string().safeParse(record.name).data?.trim() || undefined;

    const isDefault = record.default === true;

    const supportsThinking = parseOptionalBoolean(
      record.supportsThinking,
      id,
      "supportsThinking"
    );

    const supportsVision = parseOptionalBoolean(
      record.supportsVision,
      id,
      "supportsVision"
    );

    if (isDefault) {
      defaultCount += 1;
    }

    const cachedInputPerMillionUsd = parseOptionalUsdRate(
      record.cachedInputPerMillionUsd
    );

    const inputPerMillionUsd = parseOptionalUsdRate(record.inputPerMillionUsd);

    const outputPerMillionUsd = parseOptionalUsdRate(
      record.outputPerMillionUsd
    );

    if (
      (inputPerMillionUsd !== undefined && outputPerMillionUsd === undefined) ||
      (inputPerMillionUsd === undefined && outputPerMillionUsd !== undefined)
    ) {
      throw new Error(
        `Model "${id}" must set both input and output $/1M rates, or leave both blank.`
      );
    }

    const contextWindow = parseOptionalTokenCount(
      record.contextWindow,
      id,
      "contextWindow"
    );

    const maxOutputTokens = parseOptionalTokenCount(
      record.maxOutputTokens,
      id,
      "maxOutputTokens"
    );

    const model: CustomModelEntry = { id };

    if (name) {
      model.name = name;
    }

    if (contextWindow !== undefined) {
      model.contextWindow = contextWindow;
    }

    if (maxOutputTokens !== undefined) {
      model.maxOutputTokens = maxOutputTokens;
    }

    if (isDefault) {
      model.default = true;
    }

    if (supportsThinking !== undefined) {
      model.supportsThinking = supportsThinking;
    }

    if (supportsVision !== undefined) {
      model.supportsVision = supportsVision;
    }

    if (cachedInputPerMillionUsd !== undefined) {
      model.cachedInputPerMillionUsd = cachedInputPerMillionUsd;
    }

    if (inputPerMillionUsd !== undefined) {
      model.inputPerMillionUsd = inputPerMillionUsd;
    }

    if (outputPerMillionUsd !== undefined) {
      model.outputPerMillionUsd = outputPerMillionUsd;
    }

    result.push(model);
  }

  if (defaultCount > 1) {
    throw new Error("At most one model can be marked as default.");
  }

  return result;
}

function parseOptionalTokenCount<Value>(
  value: Value,
  modelId: string,
  field: string
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }

  const parsed = z.union([z.number(), z.string()]).safeParse(value);
  const numeric = parsed.success ? Number(parsed.data) : Number.NaN;

  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(
      `Model "${modelId}" has invalid ${field}: expected a positive whole number of tokens.`
    );
  }

  return numeric;
}

function parseOptionalUsdRate<Value>(value: Value): number | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }

  const parsed = z.union([z.number(), z.string()]).safeParse(value);
  const numeric = parsed.success ? Number(parsed.data) : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("Pricing rates must be non-negative numbers.");
  }

  return numeric;
}

function parseOptionalBoolean<Value>(
  value: Value,
  modelId: string,
  field: string
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = z.boolean().safeParse(value);

  if (!parsed.success) {
    throw new Error(`Model "${modelId}" has invalid ${field} flag.`);
  }

  return parsed.data;
}

export function serializeCustomModels(models: CustomModelEntry[]): string {
  return JSON.stringify(validateCustomModels(models));
}

export function findCustomModel(
  models: CustomModelEntry[] | undefined,
  modelId: string
): CustomModelEntry | undefined {
  return models?.find((model) => model.id === modelId.trim());
}
