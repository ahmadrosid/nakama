import {
  findCustomModel,
  normalizeBaseUrl,
  type CustomModelEntry,
} from "@tinyclaw/core";
import type { ProviderInstance, ProviderName } from "@tinyclaw/core";
import OpenAI from "openai";
import type { ProviderModelOption } from "./models";
import { AVAILABLE_MODELS, getDefaultModel } from "./models";
import { openRouterSlugSupportsThinking } from "./openrouter/thinking";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_OUTPUT = 8_192;

function resolveOpenRouterCatalogThinking(entry: CustomModelEntry): boolean {
  if (entry.supportsThinking !== undefined) {
    return entry.supportsThinking;
  }

  return openRouterSlugSupportsThinking(entry.id);
}

export function openRouterCustomModelsToCatalog(
  entries: CustomModelEntry[],
): ProviderModelOption[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name?.trim() || entry.id,
    provider: "openrouter" as const,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
    supportsThinking: resolveOpenRouterCatalogThinking(entry),
    ...(entry.default ? { default: true } : {}),
    ...(entry.inputPerMillionUsd !== undefined
      ? { inputPerMillionUsd: entry.inputPerMillionUsd }
      : {}),
    ...(entry.outputPerMillionUsd !== undefined
      ? { outputPerMillionUsd: entry.outputPerMillionUsd }
      : {}),
  }));
}

export function catalogCustomModelsToCatalog(
  entries: CustomModelEntry[],
  staticModels: ProviderModelOption[],
  provider: ProviderName,
): ProviderModelOption[] {
  const staticById = new Map(staticModels.map((model) => [model.id, model]));

  return entries.map((entry) => {
    const existing = staticById.get(entry.id);
    const model: ProviderModelOption = {
      ...(existing ?? {
        id: entry.id,
        provider,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxOutputTokens: DEFAULT_MAX_OUTPUT,
      }),
      id: entry.id,
      name: entry.name?.trim() || existing?.name || entry.id,
      provider,
    };

    if (entry.default) model.default = true;
    if (entry.supportsVision !== undefined) model.supportsVision = entry.supportsVision;
    if (entry.supportsThinking !== undefined) {
      model.supportsThinking = entry.supportsThinking;
    } else if (provider === "deepseek") {
      model.supportsThinking = false;
    }
    if (entry.inputPerMillionUsd !== undefined) model.inputPerMillionUsd = entry.inputPerMillionUsd;
    if (entry.outputPerMillionUsd !== undefined) model.outputPerMillionUsd = entry.outputPerMillionUsd;

    return model;
  });
}

export function openCodeGoCustomModelsToCatalog(
  entries: CustomModelEntry[],
  staticModels: ProviderModelOption[],
): ProviderModelOption[] {
  return catalogCustomModelsToCatalog(entries, staticModels, "opencode_go");
}

export function mergeOpenRouterCatalog(
  staticModels: ProviderModelOption[],
  customEntries: CustomModelEntry[],
): ProviderModelOption[] {
  const byId = new Map(staticModels.map((model) => [model.id, { ...model }]));

  for (const entry of customEntries) {
    const existing = byId.get(entry.id);
    byId.set(entry.id, {
      ...(existing ?? {
        id: entry.id,
        provider: "openrouter" as const,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxOutputTokens: DEFAULT_MAX_OUTPUT,
      }),
      id: entry.id,
      name: entry.name?.trim() || existing?.name || entry.id,
      provider: "openrouter",
      supportsThinking: resolveOpenRouterCatalogThinking(entry),
      ...(entry.default ? { default: true } : existing?.default ? { default: true } : {}),
      ...(entry.inputPerMillionUsd !== undefined
        ? { inputPerMillionUsd: entry.inputPerMillionUsd }
        : {}),
      ...(entry.outputPerMillionUsd !== undefined
        ? { outputPerMillionUsd: entry.outputPerMillionUsd }
        : {}),
    });
  }

  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function customModelsToCatalog(
  entries: CustomModelEntry[],
): ProviderModelOption[] {
  return entries.map((entry) => {
    const model: ProviderModelOption = {
      id: entry.id,
      name: entry.name?.trim() || entry.id,
      provider: "openai_compatible",
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens: DEFAULT_MAX_OUTPUT,
    };

    if (entry.default) model.default = true;
    if (entry.supportsThinking !== undefined) model.supportsThinking = entry.supportsThinking;
    if (entry.supportsVision !== undefined) model.supportsVision = entry.supportsVision;
    if (entry.inputPerMillionUsd !== undefined) model.inputPerMillionUsd = entry.inputPerMillionUsd;
    if (entry.outputPerMillionUsd !== undefined) model.outputPerMillionUsd = entry.outputPerMillionUsd;

    return model;
  });
}

export function ensureCurrentModelInCatalog(
  catalog: ProviderModelOption[],
  currentModel: string | null | undefined,
  provider: ProviderName = "openai_compatible",
): ProviderModelOption[] {
  const trimmed = currentModel?.trim();

  if (!trimmed || catalog.some((model) => model.id === trimmed)) {
    return catalog;
  }

  return [
    ...catalog,
    {
      id: trimmed,
      name: trimmed,
      provider,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens: DEFAULT_MAX_OUTPUT,
      ...(provider === "openrouter"
        ? { supportsThinking: openRouterSlugSupportsThinking(trimmed) }
        : {}),
    },
  ];
}

export function getModelsForProviderInstance(
  instance: ProviderInstance,
  currentModel?: string | null,
): ProviderModelOption[] {
  const annotate = (models: ProviderModelOption[]): ProviderModelOption[] =>
    models.map((model) => ({
      ...model,
      providerId: instance.id,
      providerLabel: instance.label,
    }));

  if (instance.type === "openai_compatible") {
    const entries = instance.customModels ?? [];
    return annotate(
      ensureCurrentModelInCatalog(
        customModelsToCatalog(entries),
        currentModel,
        "openai_compatible",
      ),
    );
  }

  if (instance.type === "openrouter") {
    const entries = instance.customModels ?? [];
    const catalog = entries.length ? openRouterCustomModelsToCatalog(entries) : [];
    return annotate(
      ensureCurrentModelInCatalog(catalog, currentModel, "openrouter"),
    );
  }

  if (
    instance.type === "openai" ||
    instance.type === "anthropic" ||
    instance.type === "gemini" ||
    instance.type === "deepseek" ||
    instance.type === "opencode_go"
  ) {
    const entries = instance.customModels ?? [];
    if (entries.length) {
      const staticModels = AVAILABLE_MODELS.filter((model) => model.provider === instance.type);
      return annotate(
        ensureCurrentModelInCatalog(
          catalogCustomModelsToCatalog(entries, staticModels, instance.type),
          currentModel,
          instance.type,
        ),
      );
    }
  }

  return annotate(AVAILABLE_MODELS.filter((model) => model.provider === instance.type));
}

export function getModelsForConfiguredProvider(
  provider: ProviderName | null,
  instance: ProviderInstance | null | undefined,
  currentModel?: string | null,
): ProviderModelOption[] {
  if (!instance) {
    return provider ? AVAILABLE_MODELS.filter((model) => model.provider === provider) : AVAILABLE_MODELS;
  }

  return getModelsForProviderInstance(instance, currentModel);
}

export function resolveOpenRouterDefaultModel(
  customModels: CustomModelEntry[] | undefined,
  model?: string,
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

export async function fetchRemoteOpenAIModels(
  baseUrl: string,
  apiKey: string,
): Promise<CustomModelEntry[]> {
  const normalized = normalizeBaseUrl(baseUrl);
  const client = new OpenAI({
    apiKey: apiKey || "not-needed",
    baseURL: normalized,
  });

  try {
    const page = await client.models.list();
    const ids = new Set<string>();

    for await (const model of page) {
      const id = model.id?.trim();

      if (id) {
        ids.add(id);
      }
    }

    if (ids.size > 0) {
      return [...ids]
        .sort((left, right) => left.localeCompare(right))
        .map((id) => ({ id, name: id }));
    }
  } catch {
    // Fall through to raw fetch for hosts without SDK-compatible models.list.
  }

  return fetchRemoteOpenAIModelsRaw(normalized, apiKey);
}

async function fetchRemoteOpenAIModelsRaw(
  baseUrl: string,
  apiKey: string,
): Promise<CustomModelEntry[]> {
  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Could not fetch models (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };

  const ids = (payload.data ?? [])
    .map((entry) => entry.id?.trim())
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) {
    throw new Error("Remote models response did not include any model ids.");
  }

  return [...new Set(ids)]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({ id, name: id }));
}

export function resolveCompatibleDefaultModel(
  customModels: CustomModelEntry[] | undefined,
  model?: string,
): string {
  const trimmed = model?.trim();

  if (trimmed && findCustomModel(customModels, trimmed)) {
    return trimmed;
  }

  const catalog = customModelsToCatalog(customModels ?? []);
  return catalog.find((entry) => entry.default)?.id ?? catalog[0]?.id ?? "custom-model";
}

export function isCompatibleModelId(
  modelId: string,
  customModels: CustomModelEntry[] | undefined,
): boolean {
  return Boolean(findCustomModel(customModels, modelId));
}

export function compatibleModelSupportsThinking(
  modelId: string,
  customModels: CustomModelEntry[] | undefined,
): boolean {
  return findCustomModel(customModels, modelId)?.supportsThinking === true;
}

export function compatibleModelSupportsVision(
  modelId: string,
  customModels: CustomModelEntry[] | undefined,
): boolean {
  return findCustomModel(customModels, modelId)?.supportsVision === true;
}
