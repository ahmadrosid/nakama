import type { ProviderInstance, ProviderName } from "@nakama/core";
import {
  type CustomModelEntry,
  findCustomModel,
  NakamaApiError,
  normalizeBaseUrl,
} from "@nakama/core";
import {
  defaultDiscoveryBaseUrl,
  NETRA_AGENT_MODEL_ID,
} from "@nakama/core/discovery-providers";
import OpenAI from "openai";
import type { ProviderModelOption } from "./models";
import { AVAILABLE_MODELS } from "./models";
import { openRouterSlugSupportsThinking } from "./openrouter/thinking";
import {
  type ProviderJsonRecord,
  parseJsonRecord,
  readProviderString,
} from "./shared";

const DEFAULT_CONTEXT_WINDOW = 128_000;

const DEFAULT_MAX_OUTPUT = 8192;

function resolveOpenRouterCatalogThinking(entry: CustomModelEntry): boolean {
  if (entry.supportsThinking !== undefined) {
    return entry.supportsThinking;
  }

  return openRouterSlugSupportsThinking(entry.id);
}

function openRouterCustomModelsToCatalog(
  entries: CustomModelEntry[]
): ProviderModelOption[] {
  return entries.map((entry) => {
    const model: ProviderModelOption = {
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      id: entry.id,
      maxOutputTokens: DEFAULT_MAX_OUTPUT,
      name: entry.name?.trim() || entry.id,
      provider: "openrouter",
      supportsThinking: resolveOpenRouterCatalogThinking(entry),
    };

    if (entry.default) {
      model.default = true;
    }

    if (entry.supportsVision !== undefined) {
      model.supportsVision = entry.supportsVision;
    }

    if (entry.inputPerMillionUsd !== undefined) {
      model.inputPerMillionUsd = entry.inputPerMillionUsd;
    }

    if (entry.outputPerMillionUsd !== undefined) {
      model.outputPerMillionUsd = entry.outputPerMillionUsd;
    }

    return model;
  });
}

function resolveCerebrasCatalogThinking(entry: CustomModelEntry): boolean {
  if (entry.supportsThinking !== undefined) {
    return entry.supportsThinking;
  }

  return false;
}

function cerebrasCustomModelsToCatalog(
  entries: CustomModelEntry[]
): ProviderModelOption[] {
  return entries.map((entry) => {
    const model: ProviderModelOption = {
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      id: entry.id,
      maxOutputTokens: DEFAULT_MAX_OUTPUT,
      name: entry.name?.trim() || entry.id,
      provider: "cerebras",
      supportsThinking: resolveCerebrasCatalogThinking(entry),
    };

    if (entry.supportsVision !== undefined) {
      model.supportsVision = entry.supportsVision;
    }

    if (entry.default) {
      model.default = true;
    }

    if (entry.inputPerMillionUsd !== undefined) {
      model.inputPerMillionUsd = entry.inputPerMillionUsd;
    }

    if (entry.outputPerMillionUsd !== undefined) {
      model.outputPerMillionUsd = entry.outputPerMillionUsd;
    }

    return model;
  });
}

function resolveFireworksCatalogThinking(entry: CustomModelEntry): boolean {
  if (entry.supportsThinking !== undefined) {
    return entry.supportsThinking;
  }

  return false;
}

function fireworksCustomModelsToCatalog(
  entries: CustomModelEntry[]
): ProviderModelOption[] {
  const staticModels = AVAILABLE_MODELS.filter(
    (model) => model.provider === "fireworks"
  );

  return catalogCustomModelsToCatalog(entries, staticModels, "fireworks").map(
    (model) => ({
      ...model,
      supportsThinking:
        model.supportsThinking === undefined
          ? resolveFireworksCatalogThinking(
              entries.find((entry) => entry.id === model.id) ?? { id: model.id }
            )
          : model.supportsThinking,
    })
  );
}

export function catalogCustomModelsToCatalog(
  entries: CustomModelEntry[],
  staticModels: ProviderModelOption[],
  provider: ProviderName
): ProviderModelOption[] {
  const staticById = new Map(staticModels.map((model) => [model.id, model]));

  return entries.map((entry) => {
    const existing = staticById.get(entry.id);

    const model: ProviderModelOption = {
      ...(existing ?? {
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        id: entry.id,
        maxOutputTokens: DEFAULT_MAX_OUTPUT,
        provider,
      }),
      id: entry.id,
      name: entry.name?.trim() || existing?.name || entry.id,
      provider,
    };

    if (entry.default) {
      model.default = true;
    }

    if (entry.supportsVision !== undefined) {
      model.supportsVision = entry.supportsVision;
    } else if (provider === "chatgpt" || provider === "xai_oauth") {
      model.supportsVision = true;
    }

    if (entry.supportsThinking !== undefined) {
      model.supportsThinking = entry.supportsThinking;
    } else if (
      provider === "deepseek" ||
      provider === "doubao" ||
      provider === "together" ||
      provider === "xiaomi" ||
      provider === "vercel_ai_gateway" ||
      provider === "mistral" ||
      provider === "qwen" ||
      provider === "qwen_cn" ||
      provider === "perplexity"
    ) {
      model.supportsThinking = false;
    }

    if (entry.inputPerMillionUsd !== undefined) {
      model.inputPerMillionUsd = entry.inputPerMillionUsd;
    }

    if (entry.outputPerMillionUsd !== undefined) {
      model.outputPerMillionUsd = entry.outputPerMillionUsd;
    }

    return model;
  });
}

function customModelsToCatalog(
  entries: CustomModelEntry[],
  provider: ProviderName = "openai_compatible"
): ProviderModelOption[] {
  return entries.map((entry) => {
    const model: ProviderModelOption = {
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      id: entry.id,
      maxOutputTokens: DEFAULT_MAX_OUTPUT,
      name: entry.name?.trim() || entry.id,
      provider,
    };

    if (entry.default) {
      model.default = true;
    }

    if (entry.supportsThinking !== undefined) {
      model.supportsThinking = entry.supportsThinking;
    }

    if (entry.supportsVision !== undefined) {
      model.supportsVision = entry.supportsVision;
    }

    if (entry.inputPerMillionUsd !== undefined) {
      model.inputPerMillionUsd = entry.inputPerMillionUsd;
    }

    if (entry.outputPerMillionUsd !== undefined) {
      model.outputPerMillionUsd = entry.outputPerMillionUsd;
    }

    return model;
  });
}

function ensureCurrentModelInCatalog(
  catalog: ProviderModelOption[],
  currentModel: string | null | undefined,
  provider: ProviderName = "openai_compatible"
): ProviderModelOption[] {
  const trimmed = currentModel?.trim();

  if (!trimmed || catalog.some((model) => model.id === trimmed)) {
    return catalog;
  }

  const model: ProviderModelOption = {
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    id: trimmed,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
    name: trimmed,
    provider,
  };

  if (provider === "openrouter") {
    model.supportsThinking = openRouterSlugSupportsThinking(trimmed);
  }

  return [...catalog, model];
}

export function getModelsForProviderInstance(
  instance: ProviderInstance,
  currentModel?: string | null
): ProviderModelOption[] {
  const annotate = (models: ProviderModelOption[]): ProviderModelOption[] =>
    models.map((model) => ({
      ...model,
      providerId: instance.id,
      providerLabel: instance.label,
    }));

  if (instance.type === "netra") {
    return annotate(
      customModelsToCatalog(
        (instance.customModels ?? []).filter(
          (entry) => entry.id === NETRA_AGENT_MODEL_ID
        ),
        "netra"
      )
    );
  }

  if (instance.type === "openai_compatible") {
    const entries = instance.customModels ?? [];

    return annotate(
      ensureCurrentModelInCatalog(
        customModelsToCatalog(entries, instance.type),
        currentModel,
        instance.type
      )
    );
  }

  if (instance.type === "openrouter") {
    const entries = instance.customModels ?? [];

    const catalog = entries.length
      ? openRouterCustomModelsToCatalog(entries)
      : [];

    return annotate(
      ensureCurrentModelInCatalog(catalog, currentModel, "openrouter")
    );
  }

  if (instance.type === "cerebras") {
    const entries = instance.customModels ?? [];

    const staticModels = AVAILABLE_MODELS.filter(
      (model) => model.provider === "cerebras"
    );

    const catalog = entries.length
      ? cerebrasCustomModelsToCatalog(entries)
      : staticModels;

    return annotate(
      ensureCurrentModelInCatalog(catalog, currentModel, "cerebras")
    );
  }

  if (instance.type === "fireworks") {
    const entries = instance.customModels ?? [];

    const staticModels = AVAILABLE_MODELS.filter(
      (model) => model.provider === "fireworks"
    );

    const catalog = entries.length
      ? fireworksCustomModelsToCatalog(entries)
      : staticModels;

    return annotate(
      ensureCurrentModelInCatalog(catalog, currentModel, "fireworks")
    );
  }

  if (instance.type === "ollama") {
    const entries = instance.customModels ?? [];

    return annotate(
      ensureCurrentModelInCatalog(
        customModelsToCatalog(entries, "ollama"),
        currentModel,
        "ollama"
      )
    );
  }

  if (
    instance.type === "openai" ||
    instance.type === "chatgpt" ||
    instance.type === "xai_oauth" ||
    instance.type === "anthropic" ||
    instance.type === "gemini" ||
    instance.type === "deepseek" ||
    instance.type === "doubao" ||
    instance.type === "together" ||
    instance.type === "xiaomi" ||
    instance.type === "vercel_ai_gateway" ||
    instance.type === "mistral" ||
    instance.type === "qwen" ||
    instance.type === "qwen_cn" ||
    instance.type === "perplexity" ||
    instance.type === "opencode_go"
  ) {
    const entries = instance.customModels ?? [];

    if (entries.length) {
      const staticModels = AVAILABLE_MODELS.filter(
        (model) => model.provider === instance.type
      );

      return annotate(
        ensureCurrentModelInCatalog(
          catalogCustomModelsToCatalog(entries, staticModels, instance.type),
          currentModel,
          instance.type
        )
      );
    }
  }

  return annotate(
    AVAILABLE_MODELS.filter((model) => model.provider === instance.type)
  );
}

export function resolveOpenRouterDefaultModel(
  customModels: CustomModelEntry[] | undefined,
  model?: string
): string {
  const trimmed = model?.trim();

  if (trimmed && findCustomModel(customModels, trimmed)) {
    return trimmed;
  }

  const catalog = openRouterCustomModelsToCatalog(customModels ?? []);

  return (
    catalog.find((entry) => entry.default)?.id ??
    catalog[0]?.id ??
    "anthropic/claude-sonnet-4-6"
  );
}

export function resolveCerebrasDefaultModel(
  customModels: CustomModelEntry[] | undefined,
  model?: string
): string {
  const trimmed = model?.trim();

  if (trimmed && findCustomModel(customModels, trimmed)) {
    return trimmed;
  }

  const catalog = cerebrasCustomModelsToCatalog(customModels ?? []);

  return (
    catalog.find((entry) => entry.default)?.id ??
    catalog[0]?.id ??
    "gpt-oss-120b"
  );
}

export function resolveFireworksDefaultModel(
  customModels: CustomModelEntry[] | undefined,
  model?: string
): string {
  const trimmed = model?.trim();

  if (trimmed && findCustomModel(customModels, trimmed)) {
    return trimmed;
  }

  const catalog = fireworksCustomModelsToCatalog(customModels ?? []);

  return (
    catalog.find((entry) => entry.default)?.id ??
    catalog[0]?.id ??
    "accounts/fireworks/models/kimi-k2p6"
  );
}

export function resolveOllamaDefaultModel(
  customModels: CustomModelEntry[] | undefined,
  model?: string
): string {
  const trimmed = model?.trim();

  if (trimmed && findCustomModel(customModels, trimmed)) {
    return trimmed;
  }

  const catalog = customModelsToCatalog(customModels ?? [], "ollama");
  const fallback = catalog.find((entry) => entry.default)?.id ?? catalog[0]?.id;

  if (!fallback) {
    throw new Error("At least one Ollama model is required.");
  }

  return fallback;
}

function catalogVisionForModelId(modelId: string): boolean | undefined {
  return AVAILABLE_MODELS.find((model) => model.id === modelId)?.supportsVision;
}

function asRecord<Value>(value: Value): ProviderJsonRecord | null {
  if (!(value instanceof Object) || Array.isArray(value)) {
    return null;
  }

  // SAFETY: Remote model entries come from JSON provider responses.
  return value as ProviderJsonRecord;
}

function stringListIncludes<Value>(value: Value, needle: string): boolean {
  return Array.isArray(value) && value.includes(needle);
}

export function inferRemoteModelVision<Value>(
  input: Value
): boolean | undefined {
  const record = asRecord(input);

  if (!record) {
    return undefined;
  }

  if (record.supports_vision === true || record.supportsVision === true) {
    return true;
  }

  if (record.supports_vision === false || record.supportsVision === false) {
    return false;
  }

  const capabilities = asRecord(record.capabilities);

  if (capabilities?.vision === true) {
    return true;
  }

  if (capabilities?.vision === false) {
    return false;
  }

  const architecture = asRecord(record.architecture);

  if (architecture) {
    if (readProviderString(architecture.modality)?.includes("image")) {
      return true;
    }

    if (stringListIncludes(architecture.input_modalities, "image")) {
      return true;
    }
  }

  const modalities = asRecord(record.modalities);

  if (stringListIncludes(modalities?.input, "image")) {
    return true;
  }
}

export function customModelEntryFromRemoteRecord<Value>(
  value: Value
): CustomModelEntry | null {
  const record = asRecord(value);

  const id =
    readProviderString(record?.id)?.trim() ||
    readProviderString(record?.name)?.trim() ||
    "";

  if (!id) {
    return null;
  }

  const recordName = readProviderString(record?.name)?.trim();
  const name = recordName || id;

  const supportsVision =
    inferRemoteModelVision(record) ?? catalogVisionForModelId(id);

  const model: CustomModelEntry = {
    id,
    name,
  };

  if (supportsVision !== undefined) {
    model.supportsVision = supportsVision;
  }

  return model;
}

export async function fetchRemoteOpenAIModels(
  baseUrl: string,
  apiKey: string
): Promise<CustomModelEntry[]> {
  const normalized = normalizeBaseUrl(baseUrl);

  const client = new OpenAI({
    apiKey: apiKey || "not-needed",
    baseURL: normalized,
  });

  try {
    const page = await client.models.list();
    const entries: CustomModelEntry[] = [];
    const ids = new Set<string>();

    for await (const model of page) {
      const entry = customModelEntryFromRemoteRecord(model);

      if (entry && !ids.has(entry.id)) {
        ids.add(entry.id);
        entries.push(entry);
      }
    }

    if (entries.length > 0) {
      return entries.sort((left, right) => left.id.localeCompare(right.id));
    }
  } catch {
    // Fall through to raw fetch for hosts without SDK-compatible models.list.
  }

  return fetchRemoteOpenAIModelsRaw(normalized, apiKey);
}

export async function fetchNetraModels(
  apiKey: string
): Promise<CustomModelEntry[]> {
  const entries = await fetchRemoteOpenAIModels(
    defaultDiscoveryBaseUrl("netra")!,
    apiKey
  );

  return entries
    .filter((entry) => entry.id === NETRA_AGENT_MODEL_ID)
    .map((entry) => ({
      ...entry,
      name: "DeepSeek V4 Flash 0731",
      supportsThinking: true,
      supportsVision: false,
    }));
}

async function fetchRemoteOpenAIModelsRaw(
  baseUrl: string,
  apiKey: string
): Promise<CustomModelEntry[]> {
  let response: Response;

  try {
    const headers = new Headers({ Accept: "application/json" });

    if (apiKey) {
      headers.set("Authorization", `Bearer ${apiKey}`);
    }

    response = await fetch(`${baseUrl}/models`, { headers });
  } catch {
    throw new NakamaApiError("Could not reach the model endpoint.", 502);
  }

  if (!response.ok) {
    const body = await response.text();
    console.warn(
      `Could not fetch models (${response.status}) from ${baseUrl}/models:`,
      body
    );

    if (response.status === 401 || response.status === 403) {
      throw new NakamaApiError(
        "The model endpoint rejected this API key. Check the key and try again.",
        400
      );
    }

    throw new NakamaApiError(
      `Could not load models from this endpoint (${response.status}). Try again.`,
      502
    );
  }

  const payload = parseJsonRecord(await response.text());
  const data = Array.isArray(payload.data) ? payload.data : [];

  const entries = data
    .map((entry) => customModelEntryFromRemoteRecord(entry))
    .filter((entry): entry is CustomModelEntry => entry !== null);

  const unique = new Map<string, CustomModelEntry>();

  for (const entry of entries) {
    if (!unique.has(entry.id)) {
      unique.set(entry.id, entry);
    }
  }

  if (unique.size === 0) {
    throw new Error("Remote models response did not include any model ids.");
  }

  return [...unique.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

export function resolveCompatibleDefaultModel(
  customModels: CustomModelEntry[] | undefined,
  model?: string
): string {
  const trimmed = model?.trim();

  if (trimmed && findCustomModel(customModels, trimmed)) {
    return trimmed;
  }

  const catalog = customModelsToCatalog(customModels ?? []);

  return (
    catalog.find((entry) => entry.default)?.id ??
    catalog[0]?.id ??
    "custom-model"
  );
}

export function isCompatibleModelId(
  modelId: string,
  customModels: CustomModelEntry[] | undefined
): boolean {
  return Boolean(findCustomModel(customModels, modelId));
}

export function compatibleModelSupportsThinking(
  modelId: string,
  customModels: CustomModelEntry[] | undefined
): boolean {
  return findCustomModel(customModels, modelId)?.supportsThinking === true;
}
