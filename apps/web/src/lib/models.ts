import type {
  ConfigureProviderRequest,
  CreateProviderRequest,
  OllamaHostMode,
  ProviderModelOption,
  WireApi,
} from "@nakama/core/contract";
import { isDiscoveryModelProvider } from "@nakama/core/discovery-providers";
import {
  OLLAMA_CLOUD_DEFAULT_BASE_URL,
  OLLAMA_LOCAL_DEFAULT_BASE_URL,
  ollamaRequiresApiKey,
} from "@nakama/core/ollama-provider-config";
import { isOpenRouterModelSlug } from "@nakama/core/openrouter-model-slug";
import { formatConfiguredProviderLabel } from "@nakama/core/provider-label";
import type { UserProviderName } from "@nakama/core/provider-resolution";

export type SelectedProvider = UserProviderName;

export function filterModelsByProvider(
  models: ProviderModelOption[],
  provider: SelectedProvider | null | undefined
): ProviderModelOption[] {
  if (!provider) {
    return models;
  }

  return models.filter((model) => model.provider === provider);
}

export function defaultModelForProvider(
  models: ProviderModelOption[],
  provider: SelectedProvider
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
  displayName?: string | null
): string {
  if (
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "openrouter" ||
    provider === "gemini" ||
    provider === "deepseek" ||
    provider === "netra" ||
    provider === "doubao" ||
    provider === "mistral" ||
    provider === "perplexity" ||
    provider === "cerebras" ||
    provider === "cloudflare" ||
    provider === "fireworks" ||
    provider === "ollama" ||
    provider === "openai_compatible" ||
    provider === "opencode_go" ||
    provider === "command_code" ||
    provider === "chatgpt" ||
    provider === "xai_oauth" ||
    provider === "minimax" ||
    provider === "minimax_cn" ||
    provider === "moonshot" ||
    provider === "moonshot_cn" ||
    provider === "zhipu" ||
    provider === "zhipu_cn" ||
    provider === "xai" ||
    provider === "groq" ||
    provider === "cheaper_inference" ||
    provider === "standardcompute" ||
    provider === "together" ||
    provider === "xiaomi" ||
    provider === "meta" ||
    provider === "qwen" ||
    provider === "qwen_cn" ||
    provider === "vercel_ai_gateway"
  ) {
    return formatConfiguredProviderLabel(provider, displayName);
  }

  return provider ?? "Provider";
}

/**
 * One entry in the provider picker. A preset is another name for an existing
 * provider type: it has its own place in the list and saves its label as the
 * provider's display name (AI Club is Netra Runtime's DeepSeek under AI Club's
 * name).
 */
export interface ProviderOption {
  id: SelectedProvider;
  label: string;
  preset?: "aiclub";
}

/** What tells picker entries apart: the preset, or else the provider type. */
export function providerOptionKey(option: ProviderOption): string {
  return option.preset ?? option.id;
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: "openai", label: "OpenAI" },
  { id: "chatgpt", label: "ChatGPT (Plus/Pro)" },
  { id: "xai_oauth", label: "Grok (SuperGrok / Premium+)" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Gemini" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "netra", label: "Netra Runtime" },
  { id: "netra", label: "AI Club", preset: "aiclub" },
  { id: "doubao", label: "Doubao (Volcengine)" },
  { id: "together", label: "Together AI" },
  { id: "xiaomi", label: "Xiaomi MiMo" },
  { id: "meta", label: "Meta Model API" },
  { id: "vercel_ai_gateway", label: "Vercel AI Gateway" },
  { id: "mistral", label: "Mistral" },
  { id: "qwen", label: "Qwen (DashScope)" },
  { id: "qwen_cn", label: "Qwen (DashScope CN)" },
  { id: "perplexity", label: "Perplexity Sonar" },
  { id: "cerebras", label: "Cerebras" },
  { id: "cloudflare", label: "Cloudflare Worker AI" },
  { id: "fireworks", label: "Fireworks" },
  { id: "ollama", label: "Ollama" },
  { id: "opencode_go", label: "OpenCode Go" },
  { id: "command_code", label: "Command Code" },
  { id: "minimax", label: "MiniMax" },
  { id: "xai", label: "xAI Grok" },
  { id: "groq", label: "Groq" },
  { id: "cheaper_inference", label: "Cheaper Inference" },
  { id: "standardcompute", label: "Standard Compute" },
  { id: "minimax_cn", label: "MiniMax (CN)" },
  { id: "moonshot", label: "Moonshot Kimi" },
  { id: "moonshot_cn", label: "Moonshot Kimi (CN)" },
  { id: "zhipu", label: "GLM (Z.ai)" },
  { id: "zhipu_cn", label: "GLM (CN)" },
  { id: "openai_compatible", label: "Custom (OpenAI-compatible)" },
];

/** Custom OpenAI-compatible endpoints can be added more than once; builtins are one instance each. */
function allowsMultipleProviderInstances(provider: SelectedProvider): boolean {
  return provider === "openai_compatible" || provider === "ollama";
}

export function isProviderTypeAlreadyConfigured(
  provider: SelectedProvider,
  configuredTypes: ReadonlySet<string>
): boolean {
  if (allowsMultipleProviderInstances(provider)) {
    return false;
  }

  return configuredTypes.has(provider);
}

export function firstAvailableProviderOption(
  configuredTypes: ReadonlySet<string>,
  preferred: SelectedProvider = "openai"
): SelectedProvider {
  if (!isProviderTypeAlreadyConfigured(preferred, configuredTypes)) {
    return preferred;
  }

  const next = PROVIDER_OPTIONS.find(
    (option) => !isProviderTypeAlreadyConfigured(option.id, configuredTypes)
  );

  return next?.id ?? "openai_compatible";
}

export function apiKeyPlaceholder(provider: SelectedProvider): string {
  if (provider === "anthropic") {
    return "sk-ant-…";
  }

  if (provider === "openrouter") {
    return "sk-or-v1-…";
  }

  if (provider === "cerebras") {
    return "csk-…";
  }

  if (provider === "fireworks") {
    return "fw_…";
  }

  if (provider === "ollama") {
    return "Optional for local Ollama";
  }

  if (provider === "chatgpt") {
    return "Use Sign in with ChatGPT";
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
  options?: { ollamaHostMode?: OllamaHostMode }
): string | null {
  if (provider === "openai_compatible") {
    return null;
  }

  if (provider === "chatgpt" || provider === "xai_oauth") {
    return null;
  }

  if (
    provider === "ollama" &&
    !ollamaRequiresApiKey(options?.ollamaHostMode ?? "local")
  ) {
    return null;
  }

  if (!apiKey.trim()) {
    return "API key is required.";
  }

  return null;
}

const LOCAL_HOST_PATTERN =
  /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|.+\.local)$/i;

/** A hosted endpoint almost always needs a key; a local one often does not. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    return LOCAL_HOST_PATTERN.test(new URL(baseUrl.trim()).hostname);
  } catch {
    return true;
  }
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

function findDuplicateModelIds(models: Array<{ id: string }>): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const model of models) {
    const id = model.id.trim();

    if (!id) {
      continue;
    }

    if (seen.has(id)) {
      duplicates.add(id);
    }

    seen.add(id);
  }

  return duplicates;
}

export function validateCustomModelsInput(
  models: Array<{
    id: string;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
  }>
): string | null {
  const valid = models.filter((model) => model.id.trim());

  if (valid.length === 0) {
    return "Add at least one model.";
  }

  const duplicateId = findDuplicateModelIds(valid).values().next().value;

  if (duplicateId) {
    return `Model ID "${duplicateId}" is in the list two times. Remove one.`;
  }

  for (const row of valid) {
    const hasInput = row.inputPerMillionUsd !== undefined;
    const hasOutput = row.outputPerMillionUsd !== undefined;

    if (hasInput !== hasOutput) {
      return `Model "${row.id.trim()}" must set both input and output $/1M rates, or leave both blank.`;
    }
  }

  return null;
}

export function validateOpenRouterModelsInput(
  models: Array<{
    id: string;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
  }>
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
  }

  return null;
}

export function validateShortlistCapabilityModelsInput(
  models: Array<{
    id: string;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
  }>
): string | null {
  return validateCustomModelsInput(models);
}

export function defaultOllamaSetupBaseUrl(hostMode: OllamaHostMode): string {
  return hostMode === "cloud"
    ? OLLAMA_CLOUD_DEFAULT_BASE_URL
    : OLLAMA_LOCAL_DEFAULT_BASE_URL;
}

const OPENCODE_GO_MODEL_ID_PATTERN = /^opencode-go\/[\w.-]+$/;

function validateOpenCodeGoModelId(model: string): string | null {
  const trimmed = model.trim();

  if (!trimmed) {
    return null;
  }

  if (!OPENCODE_GO_MODEL_ID_PATTERN.test(trimmed)) {
    return "Use opencode-go/model format, e.g. opencode-go/kimi-k2.7-code";
  }

  return null;
}

export function validateOpenCodeGoModelsInput(
  models: Array<{ id: string }>
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

export type ShortlistCapabilityProvider = Extract<
  SelectedProvider,
  "cerebras" | "cloudflare" | "fireworks"
>;

export function isShortlistCapabilityProvider(
  provider: SelectedProvider
): provider is ShortlistCapabilityProvider {
  return (
    provider === "cerebras" ||
    provider === "cloudflare" ||
    provider === "fireworks"
  );
}

type ShortlistModelRow = {
  id: string;
  name?: string;
  default?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
};

export function modelsFromShortlistRows(
  provider: ShortlistCapabilityProvider,
  rows: ShortlistModelRow[]
): ProviderModelOption[] {
  const models: ProviderModelOption[] = [];

  for (const row of rows) {
    const id = row.id.trim();

    if (!id) {
      continue;
    }

    const model: ProviderModelOption = {
      id,
      name: row.name?.trim() || id,
      provider,
    };

    if (row.default) {
      model.default = true;
    }

    if (row.supportsThinking !== undefined) {
      model.supportsThinking = row.supportsThinking;
    }

    if (row.supportsVision !== undefined) {
      model.supportsVision = row.supportsVision;
    }

    if (row.inputPerMillionUsd !== undefined) {
      model.inputPerMillionUsd = row.inputPerMillionUsd;
    }

    if (row.outputPerMillionUsd !== undefined) {
      model.outputPerMillionUsd = row.outputPerMillionUsd;
    }

    models.push(model);
  }

  return models;
}

export function modelsFromOpenRouterRows(
  rows: Array<{
    id: string;
    name?: string;
    default?: boolean;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
  }>
): ProviderModelOption[] {
  const models: ProviderModelOption[] = [];

  for (const row of rows) {
    const id = row.id.trim();

    if (!id) {
      continue;
    }

    const model: ProviderModelOption = {
      id,
      name: row.name?.trim() || id,
      provider: "openrouter",
    };

    if (row.default) {
      model.default = true;
    }

    if (row.inputPerMillionUsd !== undefined) {
      model.inputPerMillionUsd = row.inputPerMillionUsd;
    }

    if (row.outputPerMillionUsd !== undefined) {
      model.outputPerMillionUsd = row.outputPerMillionUsd;
    }

    models.push(model);
  }

  return models;
}

export function resolveOpenRouterSetupModel(
  rows: Array<{ id: string; default?: boolean }>,
  selectedModel: string
): string {
  const trimmed = selectedModel.trim();
  const valid = rows.filter((row) => row.id.trim());

  // The row the user marked as default wins over the catalog pick.
  const flagged = valid.find((row) => row.default)?.id;

  if (flagged) {
    return flagged;
  }

  if (trimmed && valid.some((row) => row.id === trimmed)) {
    return trimmed;
  }

  return valid[0]?.id ?? "";
}

function validateCustomOpenRouterModel(model: string): string | null {
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
  modelId: string | null | undefined
): string {
  if (!modelId) {
    return "Unknown";
  }

  return models.find((model) => model.id === modelId)?.name ?? modelId;
}

export function buildCreateProviderRequest(options: {
  apiKey: string;
  provider: SelectedProvider;
  model?: string;
  displayName?: string;
  baseUrl?: string;
  hostMode?: OllamaHostMode;
  customModels?: ConfigureProviderRequest["customModels"];
  openRouterRouting?: CreateProviderRequest["openRouterRouting"];
  wireApi?: WireApi;
  chatgptOAuth?: CreateProviderRequest["chatgptOAuth"];
  xaiOAuth?: CreateProviderRequest["xaiOAuth"];
}): CreateProviderRequest {
  const customModels =
    isDiscoveryModelProvider(options.provider) ||
    ([
      "openrouter",
      "xai_oauth",
      "chatgpt",
      "cerebras",
      "cloudflare",
      "fireworks",
      "ollama",
      "opencode_go",
      // Catalog providers keep a list the user changed in Add.
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
      "doubao",
      "together",
      "xiaomi",
      "meta",
      "vercel_ai_gateway",
      "mistral",
      "qwen",
      "qwen_cn",
      "perplexity",
    ].includes(options.provider) &&
      options.customModels?.length)
      ? options.customModels
      : undefined;

  return {
    apiKey: options.apiKey,
    type: options.provider,
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(options.xaiOAuth ? { xaiOAuth: options.xaiOAuth } : {}),
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(options.chatgptOAuth ? { chatgptOAuth: options.chatgptOAuth } : {}),
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(options.model ? { model: options.model } : {}),
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(options.displayName?.trim()
      ? { label: options.displayName.trim() }
      : {}),
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(options.baseUrl?.trim() ? { baseUrl: options.baseUrl.trim() } : {}),
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(options.hostMode ? { hostMode: options.hostMode } : {}),
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(options.provider === "openrouter" &&
    options.openRouterRouting &&
    Object.values(options.openRouterRouting).some(
      (value) => value !== undefined
    )
      ? { openRouterRouting: options.openRouterRouting }
      : {}),
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(customModels ? { customModels } : {}),
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(options.wireApi === "responses" ? { wireApi: options.wireApi } : {}),
  };
}

export function encodeModelSelection(
  providerId: string,
  modelId: string
): string {
  return `${providerId}::${modelId}`;
}

export function decodeModelSelection(
  value: string
): { providerId: string; modelId: string } | null {
  const separator = value.indexOf("::");

  if (separator <= 0) {
    return null;
  }

  return {
    modelId: value.slice(separator + 2),
    providerId: value.slice(0, separator),
  };
}

export function extractModelId(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }

  return decodeModelSelection(value)?.modelId ?? value;
}

export function groupModelsByProvider(models: ProviderModelOption[]): Array<{
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

    const providerLabel =
      model.providerLabel ?? formatProviderLabel(model.provider);

    const existing = groups.get(providerId);

    if (existing) {
      existing.models.push(model);
      continue;
    }

    groups.set(providerId, {
      models: [model],
      providerId,
      providerLabel,
    });
  }

  return [...groups.values()];
}

const UNSET_MODEL_VALUE = "";

export function profileModelSelectionValue(
  modelId: string | null,
  groups: ReturnType<typeof groupModelsByProvider>
): string {
  if (!modelId) {
    return UNSET_MODEL_VALUE;
  }

  const decoded = decodeModelSelection(modelId);

  if (decoded && decoded.providerId !== "__unknown__") {
    const group = groups.find(
      (entry) => entry.providerId === decoded.providerId
    );

    if (group) {
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

/**
 * Drop a remembered selection whose provider or model is gone, so a stale pick
 * falls back to the profile default instead of a model nobody can pick. An
 * explicit provider is never remapped onto another one offering the same model
 * id; empty groups mean the catalog has not loaded yet, so keep the selection.
 */
export function knownModelSelection(
  selection: string | null | undefined,
  groups: ReturnType<typeof groupModelsByProvider>
): string | null {
  if (!selection) {
    return null;
  }

  if (groups.length === 0) {
    return selection;
  }

  const decoded = decodeModelSelection(selection);
  const modelId = decoded?.modelId ?? selection;

  const pinnedProvider =
    decoded && decoded.providerId !== "__unknown__" ? decoded.providerId : null;

  const match = groups.find(
    (group) =>
      (!pinnedProvider || group.providerId === pinnedProvider) &&
      group.models.some((model) => model.id === modelId)
  );

  return match ? encodeModelSelection(match.providerId, modelId) : null;
}

/** The option a selection points at, looked up in its own provider first. */
function findModelMatch(
  selection: string | null | undefined,
  groups: ReturnType<typeof groupModelsByProvider>
) {
  if (!selection) {
    return;
  }

  const decoded = decodeModelSelection(selection);
  const resolvedModelId = decoded?.modelId ?? selection;

  if (decoded && decoded.providerId !== "__unknown__") {
    const group = groups.find(
      (entry) => entry.providerId === decoded.providerId
    );

    const model = group?.models.find((entry) => entry.id === resolvedModelId);

    if (group && model) {
      return { group, inSelectedProvider: true, model };
    }
  }

  for (const group of groups) {
    const model = group.models.find((entry) => entry.id === resolvedModelId);

    if (model) {
      return { group, inSelectedProvider: false, model };
    }
  }
}

export function profileModelLabel(
  modelId: string | null,
  groups: ReturnType<typeof groupModelsByProvider>,
  options: { withProvider?: boolean } = {}
): string {
  if (!modelId) {
    return "Select model";
  }

  const match = findModelMatch(modelId, groups);

  if (!match) {
    return decodeModelSelection(modelId)?.modelId ?? modelId;
  }

  // Match the menu items, which name the provider too.
  return options.withProvider && match.inSelectedProvider
    ? `${match.model.name} · ${match.group.providerLabel}`
    : match.model.name;
}

export function effectiveProfileModelSelection(
  profileModel: string | null | undefined,
  groups: ReturnType<typeof groupModelsByProvider>,
  defaultProviderId?: string | null
): string | null {
  if (profileModel) {
    return profileModelSelectionValue(profileModel, groups);
  }

  const active = groups.find((group) => group.providerId === defaultProviderId);

  const model =
    active?.models.find((entry) => entry.default) ?? active?.models[0];

  return model && active
    ? encodeModelSelection(active.providerId, model.id)
    : null;
}

/** The model option a picker selection points at, in its provider first. */
export function findSelectedModel(
  selection: string | null | undefined,
  groups: ReturnType<typeof groupModelsByProvider>
): ProviderModelOption | undefined {
  return findModelMatch(selection, groups)?.model;
}

export function resolveModelThinkingSupport(
  model: ProviderModelOption | undefined
): boolean | undefined {
  if (!model) {
    return;
  }

  if (
    model.provider === "openai_compatible" ||
    model.provider === "openrouter" ||
    model.provider === "deepseek" ||
    model.provider === "doubao" ||
    model.provider === "together" ||
    model.provider === "xiaomi" ||
    model.provider === "meta" ||
    model.provider === "vercel_ai_gateway" ||
    model.provider === "mistral" ||
    model.provider === "qwen" ||
    model.provider === "qwen_cn" ||
    model.provider === "perplexity" ||
    model.provider === "cerebras" ||
    model.provider === "fireworks" ||
    model.provider === "ollama"
  ) {
    return model.supportsThinking === true;
  }

  return model.supportsThinking !== false;
}

export function resolveModelVisionSupport(
  selection: string | null | undefined,
  groups: ReturnType<typeof groupModelsByProvider>
): boolean | undefined {
  if (!selection) {
    return;
  }

  const decoded = decodeModelSelection(selection);
  const resolvedModelId = decoded?.modelId ?? selection;

  const findModel = () => {
    if (decoded && decoded.providerId !== "__unknown__") {
      const group = groups.find(
        (entry) => entry.providerId === decoded.providerId
      );

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
  };

  const model = findModel();

  if (!model) {
    return;
  }

  if (
    (model.provider !== "acp" && isDiscoveryModelProvider(model.provider)) ||
    model.provider === "openai_compatible" ||
    model.provider === "opencode_go" ||
    model.provider === "deepseek" ||
    model.provider === "doubao" ||
    model.provider === "together" ||
    model.provider === "xiaomi" ||
    model.provider === "meta" ||
    model.provider === "vercel_ai_gateway" ||
    model.provider === "mistral" ||
    model.provider === "qwen" ||
    model.provider === "qwen_cn" ||
    model.provider === "perplexity" ||
    model.provider === "cerebras" ||
    model.provider === "cloudflare" ||
    model.provider === "fireworks" ||
    model.provider === "ollama" ||
    model.provider === "openrouter"
  ) {
    return model.supportsVision === true;
  }

  return model.supportsVision !== false;
}

export function filterVisionCapableProviderGroups(
  groups: ReturnType<typeof groupModelsByProvider>
): ReturnType<typeof groupModelsByProvider> {
  const visionGroups: typeof groups = [];

  for (const group of groups) {
    const models = group.models.filter(
      (model) =>
        resolveModelVisionSupport(
          encodeModelSelection(group.providerId, model.id),
          groups
        ) === true
    );

    if (models.length > 0) {
      visionGroups.push({ ...group, models });
    }
  }

  return visionGroups;
}

export const TRANSCRIPTION_MODEL_OPTIONS = [
  { id: "whisper-1", name: "Whisper" },
  { id: "gpt-4o-transcribe", name: "GPT-4o Transcribe" },
  { id: "gpt-4o-mini-transcribe", name: "GPT-4o mini Transcribe" },
] as const;

/** Sole v1 image-generation model option (matches server allowlist). */
export const IMAGE_GENERATION_MODEL_OPTIONS = [
  { id: "gpt-image-2", name: "GPT Image 2" },
] as const;

/** MiniMax image models (match server allowlist). */
export const MINIMAX_IMAGE_GENERATION_MODEL_OPTIONS = [
  { id: "MiniMax-H3-Image", name: "MiniMax H3 Image" },
  { id: "MiniMax-H3-Image-Highspeed", name: "MiniMax H3 Image Highspeed" },
] as const;

/** Workspace selection string accepted by `/v1/settings/image-generation`. */
export const IMAGE_GENERATION_SELECTION =
  `openai::${IMAGE_GENERATION_MODEL_OPTIONS[0].id}` as const;

export function modelsFromCustomRows(
  rows: Array<{
    id: string;
    name?: string;
    default?: boolean;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
  }>
): ProviderModelOption[] {
  const models: ProviderModelOption[] = [];

  for (const row of rows) {
    const id = row.id.trim();

    if (!id) {
      continue;
    }

    models.push({
      id,
      name: row.name?.trim() || id,
      provider: "openai_compatible" as const,
      // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
      ...(row.default ? { default: true } : {}),
    });
  }

  return models;
}
