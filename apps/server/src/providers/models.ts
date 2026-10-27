import type { ProviderName } from "@nakama/core";
import {
  type CustomModelEntry,
  findCustomModel,
  isDiscoveryModelProvider,
  isOpenRouterModelSlug,
  validateCustomModels,
} from "@nakama/core";
import {
  NETRA_AGENT_MODEL_ID,
  netraModelSupportsVision,
  resolveNetraModelId,
} from "@nakama/core/discovery-providers";
import {
  resolveCerebrasDefaultModel,
  resolveCompatibleDefaultModel,
  resolveFireworksDefaultModel,
  resolveOllamaDefaultModel,
  resolveOpenRouterDefaultModel,
} from "./compatible-models";
import { AVAILABLE_MODELS, type ProviderModelOption } from "./model-catalog";

export { isOpenRouterModelSlug } from "@nakama/core";

export { AVAILABLE_MODELS, type ProviderModelOption } from "./model-catalog";

type DefaultModelResolver = (
  customModels: CustomModelEntry[] | undefined,
  model?: string
) => string;

// Providers whose saved model list is the whole catalog: pick from it.
const SHORTLIST_RESOLVERS: Partial<Record<ProviderName, DefaultModelResolver>> =
  {
    cerebras: resolveCerebrasDefaultModel,
    cloudflare: resolveCompatibleDefaultModel,
    fireworks: resolveFireworksDefaultModel,
    ollama: resolveOllamaDefaultModel,
    openrouter: resolveOpenRouterDefaultModel,
  };

// Built-in catalog providers where saved custom models narrow the choice.
const CUSTOM_SHORTLIST_PROVIDERS: ReadonlySet<ProviderName> = new Set([
  "openai",
  "chatgpt",
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
  "opencode_go",
]);

// Providers that accept any model id, even one missing from the catalog.
const PASSTHROUGH_MODEL_PROVIDERS: ReadonlySet<ProviderName> = new Set([
  "openai",
  "anthropic",
  "gemini",
  "opencode_go",
  "chatgpt",
  "xai_oauth",
]);

// Used only when a provider has no catalog entry at all.
const FALLBACK_DEFAULT_MODELS: Partial<Record<ProviderName, string>> = {
  anthropic: "claude-sonnet-4-6",
  cerebras: "gpt-oss-120b",
  cloudflare: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  deepseek: "deepseek-flash",
  fireworks: "accounts/fireworks/models/kimi-k2p6",
  gemini: "gemini-2.5-flash",
  meta: "muse-spark-1.3",
  mistral: "mistral-small-2603",
  opencode_go: "opencode-go/kimi-k2.7-code",
  openrouter: "anthropic/claude-sonnet-4-6",
  perplexity: "sonar",
  qwen: "qwen3.7-plus",
  qwen_cn: "qwen3.7-plus",
  together: "openai/gpt-oss-120b",
  vercel_ai_gateway: "openai/gpt-4o-mini",
  xiaomi: "mimo-v2.5-pro",
};

const DEFAULT_FALLBACK_MODEL = "gpt-5.4";

const DEFAULT_CONTEXT_WINDOW = 128_000;

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

function requireModelIdFormat(
  entries: CustomModelEntry[],
  isValid: (id: string) => boolean,
  invalidMessage: (id: string) => string
): CustomModelEntry[] {
  const models = validateCustomModels(entries);

  for (const model of models) {
    if (!isValid(model.id)) {
      throw new Error(invalidMessage(model.id));
    }
  }

  return models;
}

function requireAtLeastOneModel(
  entries: CustomModelEntry[],
  label: string
): CustomModelEntry[] {
  const models = validateCustomModels(entries);

  if (!models.length) {
    throw new Error(`At least one ${label} model is required.`);
  }

  return models;
}

export function validateOpenRouterCustomModels(
  entries: CustomModelEntry[]
): CustomModelEntry[] {
  return requireModelIdFormat(
    entries,
    isOpenRouterModelSlug,
    (id) => `Invalid OpenRouter model id "${id}". Use vendor/model format.`
  );
}

export function validateCerebrasCustomModels(
  entries: CustomModelEntry[]
): CustomModelEntry[] {
  return validateCustomModels(entries);
}

export function validateFireworksCustomModels(
  entries: CustomModelEntry[]
): CustomModelEntry[] {
  return requireAtLeastOneModel(entries, "Fireworks");
}

export function validateOllamaCustomModels(
  entries: CustomModelEntry[]
): CustomModelEntry[] {
  return requireAtLeastOneModel(entries, "Ollama");
}

export function validateCloudflareCustomModels(
  entries: CustomModelEntry[]
): CustomModelEntry[] {
  return requireModelIdFormat(
    entries,
    (id) => id.trim().startsWith("@cf/") || id.trim().startsWith("@hf/"),
    (id) => `Invalid Cloudflare model id "${id}". Use @cf/ or @hf/ format.`
  );
}

export function validateOpenCodeGoCustomModels(
  entries: CustomModelEntry[]
): CustomModelEntry[] {
  return requireModelIdFormat(
    entries,
    (id) => id.trim().startsWith("opencode-go/"),
    (id) =>
      `Invalid OpenCode Go model id "${id}". Use opencode-go/model format.`
  );
}

export function getModelById(modelId: string): ProviderModelOption | undefined {
  return AVAILABLE_MODELS.find((model) => model.id === modelId);
}

export function getModelsForProvider(
  provider: ProviderName
): ProviderModelOption[] {
  return AVAILABLE_MODELS.filter((model) => model.provider === provider);
}

/** Compaction sizing for one model.
 *
 * A custom model id is never in the built-in catalog, so without the instance
 * entry every custom provider would silently compact at the fallback window.
 * Entries that leave the sizes blank keep the catalog value, then the fallback.
 */
export interface ProviderModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

export function resolveModelLimits(
  provider: ProviderName,
  modelId: string,
  customModels?: CustomModelEntry[]
): ProviderModelLimits {
  const catalog = getModelsForProvider(provider).find(
    (model) => model.id === modelId
  );

  const custom = findCustomModel(customModels, modelId);

  return {
    contextWindow:
      custom?.contextWindow ?? catalog?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens:
      custom?.maxOutputTokens ??
      catalog?.maxOutputTokens ??
      DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

export function getDefaultModel(
  provider: ProviderName,
  customModels?: CustomModelEntry[]
): string {
  if (provider === "netra") {
    return NETRA_AGENT_MODEL_ID;
  }

  if (isDiscoveryModelProvider(provider) || provider === "xai_oauth") {
    // Discovery providers and Grok subscription fetch model lists live
    // and store them as instance custom models — no hardcoded catalog.
    return resolveCompatibleDefaultModel(customModels);
  }

  if (customModels?.length) {
    const resolver = SHORTLIST_RESOLVERS[provider];

    if (resolver) {
      return resolver(customModels);
    }

    if (CUSTOM_SHORTLIST_PROVIDERS.has(provider)) {
      return resolveCompatibleDefaultModel(customModels);
    }
  }

  const models = getModelsForProvider(provider);

  return (
    models.find((model) => model.default)?.id ??
    models[0]?.id ??
    FALLBACK_DEFAULT_MODELS[provider] ??
    DEFAULT_FALLBACK_MODEL
  );
}

export function resolveModel(
  provider: ProviderName,
  model?: string,
  customModels?: CustomModelEntry[]
): string {
  const trimmed = model?.trim();

  if (!trimmed) {
    return getDefaultModel(provider, customModels);
  }

  if (provider === "netra") {
    return resolveNetraModelId(trimmed);
  }

  if (provider === "openrouter" && isOpenRouterModelSlug(trimmed)) {
    return trimmed;
  }

  // Each resolver returns `trimmed` when it is a saved model, else the default.
  const resolver =
    provider === "openrouter" ? undefined : SHORTLIST_RESOLVERS[provider];

  if (resolver && customModels?.length) {
    return resolver(customModels, trimmed);
  }

  if (isDiscoveryModelProvider(provider)) {
    return resolveCompatibleDefaultModel(customModels, trimmed);
  }

  // ChatGPT accepts any id its account offers, so a saved list does not
  // snap an unknown id back to the default.
  if (
    customModels?.length &&
    provider !== "chatgpt" &&
    CUSTOM_SHORTLIST_PROVIDERS.has(provider)
  ) {
    return resolveCompatibleDefaultModel(customModels, trimmed);
  }

  // Provider-scoped check: region variants (e.g. minimax vs minimax_cn) may
  // expose identical model ids, so global id uniqueness must not be assumed.
  if (
    getModelsForProvider(provider).some((entry) => entry.id === trimmed) ||
    PASSTHROUGH_MODEL_PROVIDERS.has(provider)
  ) {
    return trimmed;
  }

  return getDefaultModel(provider, customModels);
}

// Shortlist providers know vision only from the saved entry or the catalog.
const SHORTLIST_VISION_PROVIDERS: ReadonlySet<ProviderName> = new Set([
  "cerebras",
  "cloudflare",
  "fireworks",
  "ollama",
]);

const ASSUMED_VISION_PROVIDERS: ReadonlySet<ProviderName> = new Set([
  "openai",
  "anthropic",
  "gemini",
  "chatgpt",
  "xai_oauth",
]);

export function modelSupportsVision(
  modelId: string,
  provider: ProviderName,
  customModels?: CustomModelEntry[]
): boolean | undefined {
  // Netra serves a fixed set of models, so its own catalog wins over saved
  // entries, which may carry a stale flag or none.
  if (provider === "netra") {
    return netraModelSupportsVision(modelId);
  }

  const custom = findCustomModel(customModels, modelId);

  if (custom?.supportsVision !== undefined) {
    return custom.supportsVision;
  }

  if (
    isDiscoveryModelProvider(provider) ||
    provider === "opencode_go" ||
    provider === "deepseek"
  ) {
    return false;
  }

  const catalogVision = getModelById(modelId)?.supportsVision;

  if (catalogVision !== undefined) {
    return catalogVision;
  }

  if (SHORTLIST_VISION_PROVIDERS.has(provider)) {
    return false;
  }

  if (ASSUMED_VISION_PROVIDERS.has(provider)) {
    return true;
  }
}

const TRANSCRIPTION_MODEL_IDS = new Set([
  "whisper-1",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
]);

export function modelSupportsTranscription(
  modelId: string,
  provider: ProviderName
): boolean {
  // openai_compatible instances are self-hosted Whisper-style endpoints whose
  // model id is user-defined; any non-empty id is accepted. First-party
  // openai stays restricted to the allowlist.
  if (provider === "openai_compatible") {
    return Boolean(modelId.trim());
  }

  if (provider !== "openai") {
    return false;
  }

  return TRANSCRIPTION_MODEL_IDS.has(modelId.trim());
}

/** Sole v1 image-generation model id (OpenAI Images API). */
export const IMAGE_GENERATION_MODEL_ID = "gpt-image-2";

/** Sole allowlisted workspace selection: provider type + model id. */
export const IMAGE_GENERATION_SELECTION = `openai::${IMAGE_GENERATION_MODEL_ID}`;

const IMAGE_GENERATION_MODEL_IDS = new Set([IMAGE_GENERATION_MODEL_ID]);

export function modelSupportsImageGeneration(
  modelId: string,
  provider: ProviderName
): boolean {
  // openai_compatible instances route through the OpenAI Images API against
  // the configured baseUrl; both flavors use the same model allowlist.
  if (provider !== "openai" && provider !== "openai_compatible") {
    return false;
  }

  return IMAGE_GENERATION_MODEL_IDS.has(modelId.trim());
}

export function isAllowedImageGenerationSelection(
  value: string | null | undefined
): boolean {
  const trimmed = value?.trim();

  if (trimmed === IMAGE_GENERATION_SELECTION) {
    return true;
  }

  // Self-hosted OpenAI-compatible backends carry a baseUrl and reuse the same
  // Images API + model allowlist, selected via `openai_compatible::gpt-image-2`.
  return trimmed === `openai_compatible::${IMAGE_GENERATION_MODEL_ID}`;
}
