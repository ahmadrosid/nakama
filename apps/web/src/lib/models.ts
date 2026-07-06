import type {
  ConfigureProviderRequest,
  CreateProviderRequest,
  ProviderModelOption,
} from "@nakama/core/contract";
import { formatConfiguredProviderLabel } from "@nakama/core/provider-label";
import type { UserProviderName } from "@nakama/core/provider-resolution";

export type SelectedProvider = UserProviderName;

export const OPENROUTER_MODEL_SLUG_PATTERN = /^[\w.-]+\/[\w.:-]+$/;

export function isOpenRouterModelSlug(model: string): boolean {
  return OPENROUTER_MODEL_SLUG_PATTERN.test(model.trim());
}

export function filterModelsByProvider(
  models: ProviderModelOption[],
  provider: SelectedProvider | null | undefined,
): ProviderModelOption[] {
  if (!provider) {
    return models;
  }

  return models.filter((model) => model.provider === provider);
}

export function defaultModelForProvider(
  models: ProviderModelOption[],
  provider: SelectedProvider,
): string {
  const providerModels = filterModelsByProvider(models, provider);
  return (
    providerModels.find((model) => model.default)?.id ??
    providerModels[0]?.id ??
    ""
  );
}

export function formatProviderLabel(
  provider: string | null | undefined,
  displayName?: string | null,
): string {
  if (
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "openrouter" ||
    provider === "gemini" ||
    provider === "deepseek" ||
    provider === "openai_compatible" ||
    provider === "opencode_go"
  ) {
    return formatConfiguredProviderLabel(provider, displayName);
  }

  return provider ?? "Provider";
}

export const PROVIDER_OPTIONS: Array<{ id: SelectedProvider; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Gemini" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "opencode_go", label: "OpenCode Go" },
  { id: "openai_compatible", label: "Custom (OpenAI-compatible)" },
];

export function apiKeyPlaceholder(provider: SelectedProvider): string {
  if (provider === "anthropic") {
    return "sk-ant-…";
  }

  if (provider === "openrouter") {
    return "sk-or-v1-…";
  }

  if (provider === "gemini") {
    return "AIza…";
  }

  if (provider === "openai_compatible") {
    return "Optional for local endpoints";
  }

  if (provider === "opencode_go") {
    return "oc-…";
  }

  return "sk-…";
}

export function validateApiKeyForProvider(
  apiKey: string,
  provider: SelectedProvider,
): string | null {
  if (provider === "openai_compatible") {
    return null;
  }

  if (!apiKey.trim()) {
    return "API key is required.";
  }

  return null;
}

export function validateDisplayNameInput(displayName: string): string | null {
  const trimmed = displayName.trim();

  if (!trimmed) {
    return "Provider name is required.";
  }

  return null;
}

export function validateBaseUrlInput(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();

  if (!trimmed) {
    return "Base URL is required.";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Base URL must use http or https.";
    }
  } catch {
    return "Enter a valid base URL.";
  }

  return null;
}

export function validateCustomModelsInput(
  models: Array<{ id: string }>,
): string | null {
  const valid = models.filter((model) => model.id.trim());

  if (valid.length === 0) {
    return "Add at least one model.";
  }

  return null;
}

export function validateOpenRouterModelsInput(
  models: Array<{
    id: string;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
  }>,
): string | null {
  const listError = validateCustomModelsInput(models);
  if (listError) {
    return listError;
  }

  for (const row of models) {
    const slugError = validateCustomOpenRouterModel(row.id);
    if (slugError) {
      return slugError;
    }

    const hasInput = row.inputPerMillionUsd !== undefined;
    const hasOutput = row.outputPerMillionUsd !== undefined;
    if (hasInput !== hasOutput) {
      return `Model "${row.id.trim()}" must set both input and output $/1M rates, or leave both blank.`;
    }
  }

  return null;
}

const OPENCODE_GO_MODEL_ID_PATTERN = /^opencode-go\/[\w.-]+$/;

export function validateOpenCodeGoModelId(model: string): string | null {
  const trimmed = model.trim();

  if (!trimmed) {
    return null;
  }

  if (!OPENCODE_GO_MODEL_ID_PATTERN.test(trimmed)) {
    return 'Use opencode-go/model format, e.g. opencode-go/kimi-k2.7-code';
  }

  return null;
}

export function validateOpenCodeGoModelsInput(
  models: Array<{ id: string }>,
): string | null {
  const listError = validateCustomModelsInput(models);
  if (listError) {
    return listError;
  }

  for (const row of models) {
    const idError = validateOpenCodeGoModelId(row.id);
    if (idError) {
      return idError;
    }
  }

  return null;
}

export function modelsFromOpenRouterRows(
  rows: Array<{
    id: string;
    name?: string;
    default?: boolean;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
  }>,
): ProviderModelOption[] {
  return rows
    .filter((row) => row.id.trim())
    .map((row) => ({
      id: row.id.trim(),
      name: row.name?.trim() || row.id.trim(),
      provider: "openrouter" as const,
      ...(row.default ? { default: true } : {}),
      ...(row.inputPerMillionUsd !== undefined
        ? { inputPerMillionUsd: row.inputPerMillionUsd }
        : {}),
      ...(row.outputPerMillionUsd !== undefined
        ? { outputPerMillionUsd: row.outputPerMillionUsd }
        : {}),
    }));
}

export function appendOpenRouterModelRow(
  rows: Array<{
    id: string;
    name?: string;
    default?: boolean;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
  }>,
  modelId: string,
  modelName: string,
  pricing?: { inputPerMillionUsd?: number; outputPerMillionUsd?: number },
): Array<{
  id: string;
  name: string;
  default?: boolean;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}> {
  const base = rows
    .filter((row) => row.id.trim())
    .map((row) => ({
      id: row.id,
      name: row.name ?? row.id,
      ...(row.default ? { default: true } : {}),
      ...(row.inputPerMillionUsd !== undefined
        ? { inputPerMillionUsd: row.inputPerMillionUsd }
        : {}),
      ...(row.outputPerMillionUsd !== undefined
        ? { outputPerMillionUsd: row.outputPerMillionUsd }
        : {}),
    }));

  if (base.some((row) => row.id === modelId)) {
    return base.map((row) => ({
      id: row.id,
      name: row.name ?? row.id,
      default: row.id === modelId,
      ...(row.inputPerMillionUsd !== undefined
        ? { inputPerMillionUsd: row.inputPerMillionUsd }
        : {}),
      ...(row.outputPerMillionUsd !== undefined
        ? { outputPerMillionUsd: row.outputPerMillionUsd }
        : {}),
    }));
  }

  return [
    ...base.map((row) => ({
      id: row.id,
      name: row.name ?? row.id,
      ...(row.inputPerMillionUsd !== undefined
        ? { inputPerMillionUsd: row.inputPerMillionUsd }
        : {}),
      ...(row.outputPerMillionUsd !== undefined
        ? { outputPerMillionUsd: row.outputPerMillionUsd }
        : {}),
    })),
    {
      id: modelId,
      name: modelName,
      default: true,
      ...(pricing?.inputPerMillionUsd !== undefined
        ? { inputPerMillionUsd: pricing.inputPerMillionUsd }
        : {}),
      ...(pricing?.outputPerMillionUsd !== undefined
        ? { outputPerMillionUsd: pricing.outputPerMillionUsd }
        : {}),
    },
  ];
}

export function resolveOpenRouterSetupModel(
  rows: Array<{ id: string; default?: boolean }>,
  selectedModel: string,
): string {
  const trimmed = selectedModel.trim();
  const valid = rows.filter((row) => row.id.trim());

  if (trimmed && valid.some((row) => row.id === trimmed)) {
    return trimmed;
  }

  return valid.find((row) => row.default)?.id ?? valid[0]?.id ?? "";
}

export function validateCustomOpenRouterModel(model: string): string | null {
  const trimmed = model.trim();

  if (!trimmed) {
    return null;
  }

  if (!isOpenRouterModelSlug(trimmed)) {
    return "Use vendor/model format, e.g. anthropic/claude-sonnet-4-6";
  }

  return null;
}

export function getModelDisplayName(
  models: ProviderModelOption[],
  modelId: string | null | undefined,
): string {
  if (!modelId) {
    return "Unknown";
  }

  return models.find((model) => model.id === modelId)?.name ?? modelId;
}

export function resolveModelForProvider(
  provider: SelectedProvider,
  catalogModel: string,
  customModel?: string,
): string {
  const custom = customModel?.trim();

  if (provider === "openrouter" && custom) {
    return custom;
  }

  return catalogModel;
}

export function buildCreateProviderRequest(options: {
  apiKey: string;
  provider: SelectedProvider;
  model?: string;
  displayName?: string;
  baseUrl?: string;
  customModels?: ConfigureProviderRequest["customModels"];
}): CreateProviderRequest {
  const request = buildConfigureProviderRequest(options);

  return {
    type: request.provider,
    apiKey: request.apiKey,
    ...(request.model ? { model: request.model } : {}),
    ...(options.displayName?.trim() ? { label: options.displayName.trim() } : {}),
    ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}),
    ...(request.customModels ? { customModels: request.customModels } : {}),
  };
}

export function buildConfigureProviderRequest(options: {
  apiKey: string;
  provider: SelectedProvider;
  model?: string;
  displayName?: string;
  baseUrl?: string;
  customModels?: ConfigureProviderRequest["customModels"];
}): ConfigureProviderRequest {
  const request: ConfigureProviderRequest = {
    apiKey: options.apiKey,
    provider: options.provider,
    ...(options.model ? { model: options.model } : {}),
  };

  if (options.provider === "openai_compatible") {
    return {
      ...request,
      displayName: options.displayName?.trim(),
      baseUrl: options.baseUrl?.trim(),
      customModels: options.customModels,
    };
  }

  if (options.provider === "openrouter" && options.customModels?.length) {
    return {
      ...request,
      customModels: options.customModels,
    };
  }

  if (options.provider === "opencode_go" && options.customModels?.length) {
    return {
      ...request,
      customModels: options.customModels,
    };
  }

  if (options.provider === "opencode_go") {
    return request;
  }

  const baseUrl = options.baseUrl?.trim();
  if (baseUrl) {
    return { ...request, baseUrl };
  }

  return request;
}

export function encodeModelSelection(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function decodeModelSelection(
  value: string,
): { providerId: string; modelId: string } | null {
  const separator = value.indexOf("::");

  if (separator <= 0) {
    return null;
  }

  return {
    providerId: value.slice(0, separator),
    modelId: value.slice(separator + 2),
  };
}

export function extractModelId(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  return decodeModelSelection(value)?.modelId ?? value;
}

export function groupModelsByProvider(
  models: ProviderModelOption[],
): Array<{
  providerId: string;
  providerLabel: string;
  models: ProviderModelOption[];
}> {
  const groups = new Map<
    string,
    { providerId: string; providerLabel: string; models: ProviderModelOption[] }
  >();

  for (const model of models) {
    const providerId = model.providerId ?? model.provider;
    const providerLabel = model.providerLabel ?? formatProviderLabel(model.provider);
    const existing = groups.get(providerId);

    if (existing) {
      existing.models.push(model);
      continue;
    }

    groups.set(providerId, {
      providerId,
      providerLabel,
      models: [model],
    });
  }

  return [...groups.values()];
}

export const UNSET_MODEL_VALUE = "";

/** Visible rows before a model select list scrolls (~SelectItem py-1 + text-sm). */
export const MODEL_SELECT_MAX_VISIBLE_ROWS = 25;

export const modelSelectContentMaxHeightClass = `max-h-[min(calc(1.75rem*${MODEL_SELECT_MAX_VISIBLE_ROWS}+0.5rem),var(--available-height))]`;

export function profileModelSelectionValue(
  modelId: string | null,
  groups: ReturnType<typeof groupModelsByProvider>,
): string {
  if (!modelId) {
    return UNSET_MODEL_VALUE;
  }

  const decoded = decodeModelSelection(modelId);

  if (decoded && decoded.providerId !== "__unknown__") {
    const group = groups.find((entry) => entry.providerId === decoded.providerId);

    if (group?.models.some((model) => model.id === decoded.modelId)) {
      return modelId;
    }
  }

  const resolvedModelId = decoded?.modelId ?? modelId;

  for (const group of groups) {
    if (group.models.some((model) => model.id === resolvedModelId)) {
      return encodeModelSelection(group.providerId, resolvedModelId);
    }
  }

  return encodeModelSelection("__unknown__", resolvedModelId);
}

export function profileModelLabel(
  modelId: string | null,
  groups: ReturnType<typeof groupModelsByProvider>,
): string {
  if (!modelId) {
    return "Select model";
  }

  const decoded = decodeModelSelection(modelId);
  const resolvedModelId = decoded?.modelId ?? modelId;

  if (decoded && decoded.providerId !== "__unknown__") {
    const group = groups.find((entry) => entry.providerId === decoded.providerId);
    const match = group?.models.find((model) => model.id === resolvedModelId);

    if (match) {
      return match.name;
    }
  }

  for (const group of groups) {
    const match = group.models.find((model) => model.id === resolvedModelId);
    if (match) {
      return match.name;
    }
  }

  return resolvedModelId;
}

export function effectiveProfileModelSelection(
  profileModel: string | null | undefined,
  groups: ReturnType<typeof groupModelsByProvider>,
): string | null {
  if (!profileModel) {
    return null;
  }

  return profileModelSelectionValue(profileModel, groups);
}

export function resolveModelThinkingSupport(
  selection: string | null | undefined,
  groups: ReturnType<typeof groupModelsByProvider>,
): boolean | undefined {
  if (!selection) {
    return undefined;
  }

  const decoded = decodeModelSelection(selection);
  const resolvedModelId = decoded?.modelId ?? selection;

  const findModel = () => {
    if (decoded && decoded.providerId !== "__unknown__") {
      const group = groups.find((entry) => entry.providerId === decoded.providerId);
      const match = group?.models.find((model) => model.id === resolvedModelId);
      if (match) {
        return match;
      }
    }

    for (const group of groups) {
      const match = group.models.find((model) => model.id === resolvedModelId);
      if (match) {
        return match;
      }
    }

    return undefined;
  };

  const model = findModel();
  if (!model) {
    return undefined;
  }

  if (
    model.provider === "openai_compatible" ||
    model.provider === "openrouter" ||
    model.provider === "deepseek"
  ) {
    return model.supportsThinking === true;
  }

  return model.supportsThinking !== false;
}

export function resolveModelVisionSupport(
  selection: string | null | undefined,
  groups: ReturnType<typeof groupModelsByProvider>,
): boolean | undefined {
  if (!selection) {
    return undefined;
  }

  const decoded = decodeModelSelection(selection);
  const resolvedModelId = decoded?.modelId ?? selection;

  const findModel = () => {
    if (decoded && decoded.providerId !== "__unknown__") {
      const group = groups.find((entry) => entry.providerId === decoded.providerId);
      const match = group?.models.find((model) => model.id === resolvedModelId);
      if (match) {
        return match;
      }
    }

    for (const group of groups) {
      const match = group.models.find((model) => model.id === resolvedModelId);
      if (match) {
        return match;
      }
    }

    return undefined;
  };

  const model = findModel();
  if (!model) {
    return undefined;
  }

  if (model.provider === "openai_compatible" || model.provider === "opencode_go" || model.provider === "deepseek") {
    return model.supportsVision === true;
  }

  return model.supportsVision !== false;
}

export const TRANSCRIPTION_MODEL_OPTIONS = [
  { id: "whisper-1", name: "Whisper" },
  { id: "gpt-4o-transcribe", name: "GPT-4o Transcribe" },
  { id: "gpt-4o-mini-transcribe", name: "GPT-4o mini Transcribe" },
] as const;

export function modelsFromCustomRows(
  rows: Array<{ id: string; name?: string; default?: boolean; inputPerMillionUsd?: number; outputPerMillionUsd?: number }>,
): ProviderModelOption[] {
  return rows
    .filter((row) => row.id.trim())
    .map((row) => ({
      id: row.id.trim(),
      name: row.name?.trim() || row.id.trim(),
      provider: "openai_compatible" as const,
      ...(row.default ? { default: true } : {}),
    }));
}
