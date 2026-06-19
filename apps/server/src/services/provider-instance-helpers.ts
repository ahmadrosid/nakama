import {
  findCustomModel,
  isValidBaseUrl,
  normalizeBaseUrl,
  validateCustomModels,
  validateDisplayName,
} from "@tinyclaw/core";
import type {
  CreateProviderRequest,
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@tinyclaw/core/contract";
import {
  createProviderInstanceId,
  findProviderInstance,
  normalizeProviderInstanceLabel,
  type ProviderInstance,
  validateProviderInstanceLabel,
} from "@tinyclaw/core";
import {
  getDefaultModel,
  getModelById,
  getModelsForProviderInstance,
  isCompatibleModelId,
  isOpenRouterModelSlug,
  resolveModel,
  validateOpenCodeGoCustomModels,
  validateOpenRouterCustomModels,
} from "../providers";

export function toProviderInstanceSummary(
  instance: ProviderInstance,
  modelCount: number,
): ProviderInstanceSummary {
  return {
    id: instance.id,
    type: instance.type,
    label: normalizeProviderInstanceLabel(instance.type, instance.label, []),
    hasApiKey: Boolean(instance.apiKey.trim()) || instance.type === "openai_compatible",
    baseUrl: instance.baseUrl ?? null,
    ...(instance.customModels?.length ? { customModels: instance.customModels } : {}),
    modelCount,
    createdAt: instance.createdAt,
  };
}

export function countModelsForInstance(instance: ProviderInstance): number {
  return getModelsForProviderInstance(instance).length;
}

export function resolveInitialModel(
  instance: ProviderInstance,
  requestedModel?: string,
): string {
  const trimmed = requestedModel?.trim();

  if (trimmed) {
    return resolveModel(instance.type, trimmed, instance.customModels);
  }

  return getDefaultModel(instance.type, instance.customModels);
}

export function modelExistsOnInstance(
  instance: ProviderInstance,
  modelId: string,
): boolean {
  const trimmed = modelId.trim();

  if (!trimmed) {
    return false;
  }

  const catalog = getModelsForProviderInstance(instance);
  if (catalog.some((model) => model.id === trimmed)) {
    return true;
  }

  if (instance.type === "openrouter" && isOpenRouterModelSlug(trimmed)) {
    return true;
  }

  if (instance.type === "openai_compatible") {
    return isCompatibleModelId(trimmed, instance.customModels);
  }

  if (instance.type === "opencode_go" && trimmed.startsWith("opencode-go/")) {
    if (instance.customModels?.length) {
      return findCustomModel(instance.customModels, trimmed) !== undefined;
    }
    return true;
  }

  if (
    instance.type === "openai" ||
    instance.type === "anthropic" ||
    instance.type === "gemini"
  ) {
    if (instance.customModels?.length) {
      return findCustomModel(instance.customModels, trimmed) !== undefined;
    }
    return Boolean(getModelById(trimmed)?.provider === instance.type);
  }

  return Boolean(getModelById(trimmed)?.provider === instance.type);
}

export function resolveDefaultModelForInstance(instance: ProviderInstance): string {
  return getDefaultModel(instance.type, instance.customModels);
}

export function buildProviderInstanceFromCreateRequest(
  request: CreateProviderRequest,
  existing: ProviderInstance[],
): ProviderInstance {
  const type = request.type;
  const trimmedKey = request.apiKey.trim();
  const apiKey = trimmedKey;

  if (!apiKey && type !== "openai_compatible") {
    throw new Error("API key is required.");
  }

  const fields = buildProviderFieldsFromRequest(request);
  const rawLabel = request.label?.trim()
    ? validateProviderInstanceLabel(request.label, type)
    : fields.label;
  const label = normalizeProviderInstanceLabel(type, rawLabel, existing);

  return {
    id: createProviderInstanceId(),
    type,
    label,
    apiKey,
    ...fields,
    createdAt: new Date().toISOString(),
  };
}

export function applyProviderInstanceUpdate(
  instance: ProviderInstance,
  request: UpdateProviderRequest,
): ProviderInstance {
  const next: ProviderInstance = { ...instance };

  if (request.label !== undefined) {
    next.label = validateProviderInstanceLabel(request.label, instance.type);
  }

  if (request.apiKey !== undefined && request.apiKey.trim()) {
    next.apiKey = request.apiKey.trim();
  }

  if (request.baseUrl !== undefined) {
    const normalized = normalizeBaseUrl(request.baseUrl);
    if (!isValidBaseUrl(normalized)) {
      throw new Error("A valid http(s) base URL is required.");
    }
    next.baseUrl = normalized;
  }

  if (request.customModels !== undefined) {
    if (instance.type === "openai_compatible") {
      next.customModels = validateCustomModels(request.customModels);
      if (!next.customModels.length) {
        throw new Error("At least one model is required.");
      }
    } else if (instance.type === "openrouter") {
      next.customModels = validateOpenRouterCustomModels(request.customModels);
    } else if (instance.type === "opencode_go") {
      next.customModels = validateOpenCodeGoCustomModels(request.customModels);
    } else if (
      instance.type === "openai" ||
      instance.type === "anthropic" ||
      instance.type === "gemini"
    ) {
      next.customModels = validateCustomModels(request.customModels);
    }
  }

  return next;
}

function buildProviderFieldsFromRequest(
  request: CreateProviderRequest,
): Pick<ProviderInstance, "baseUrl" | "customModels" | "label"> {
  const type = request.type;

  if (type === "opencode_go") {
    let customModels = request.customModels?.length
      ? validateOpenCodeGoCustomModels(request.customModels)
      : undefined;

    if (!customModels?.length && request.model?.trim()) {
      customModels = validateOpenCodeGoCustomModels([
        { id: request.model.trim(), default: true },
      ]);
    }

    return { ...(customModels ? { customModels } : {}) };
  }

  if (type === "openai_compatible") {
    const label = validateDisplayName(request.label ?? "");
    const baseUrl = normalizeBaseUrl(request.baseUrl ?? "");
    if (!isValidBaseUrl(baseUrl)) {
      throw new Error("A valid http(s) base URL is required.");
    }

    let customModels = request.customModels?.length
      ? validateCustomModels(request.customModels)
      : undefined;

    if (!customModels?.length && request.model?.trim()) {
      customModels = validateCustomModels([{ id: request.model.trim(), default: true }]);
    }

    if (!customModels?.length) {
      throw new Error("At least one model is required.");
    }

    return { label, baseUrl, customModels };
  }

  if (type === "openrouter") {
    const customModels = request.customModels?.length
      ? validateOpenRouterCustomModels(request.customModels)
      : undefined;
    return { ...(customModels ? { customModels } : {}) };
  }

  const rawBaseUrl = request.baseUrl?.trim();
  if (!rawBaseUrl) {
    return {};
  }

  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  if (!isValidBaseUrl(baseUrl)) {
    throw new Error("A valid http(s) base URL is required.");
  }

  return { baseUrl };
}

export function mergeModelsForConfig(
  providers: ProviderInstance[],
): ProviderModelOption[] {
  const models: ProviderModelOption[] = [];

  for (const instance of providers) {
    models.push(...getModelsForProviderInstance(instance));
  }

  return models;
}

export interface ResolvedProfileProviderSelection {
  instance: ProviderInstance;
  model: string;
}

export function decodeStoredModelSelection(
  value: string | null | undefined,
): { providerId: string; modelId: string } | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const separator = trimmed.indexOf("::");

  if (separator <= 0) {
    return null;
  }

  return {
    providerId: trimmed.slice(0, separator),
    modelId: trimmed.slice(separator + 2),
  };
}

export function extractStoredModelId(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return decodeStoredModelSelection(trimmed)?.modelId ?? trimmed;
}

export function resolveProfileProviderSelection(options: {
  providers: ProviderInstance[];
  defaultProviderId: string | null | undefined;
  profileModel: string | null | undefined;
}): ResolvedProfileProviderSelection | null {
  const { providers, defaultProviderId, profileModel } = options;
  const active = defaultProviderId ? findProviderInstance({ providers }, defaultProviderId) : null;
  const fallbackInstance = active ?? providers[0] ?? null;

  if (!fallbackInstance) {
    return null;
  }

  const decoded = decodeStoredModelSelection(profileModel);

  if (decoded && decoded.providerId !== "__unknown__") {
    const explicit = findProviderInstance({ providers }, decoded.providerId);

    if (explicit && modelExistsOnInstance(explicit, decoded.modelId)) {
      return {
        instance: explicit,
        model: resolveModel(explicit.type, decoded.modelId, explicit.customModels),
      };
    }
  }

  const selectedModel = extractStoredModelId(profileModel);

  if (selectedModel) {
    const matchingProviders = providers.filter((instance) =>
      modelExistsOnInstance(instance, selectedModel),
    );

    if (active && matchingProviders.some((instance) => instance.id === active.id)) {
      return {
        instance: active,
        model: resolveModel(active.type, selectedModel, active.customModels),
      };
    }

    const catalogProvider = getModelById(selectedModel)?.provider;
    const preferred =
      (catalogProvider
        ? matchingProviders.find((instance) => instance.type === catalogProvider)
        : null) ??
      matchingProviders[0];

    if (preferred) {
      return {
        instance: preferred,
        model: resolveModel(preferred.type, selectedModel, preferred.customModels),
      };
    }
  }

  return {
    instance: fallbackInstance,
    model: resolveDefaultModelForInstance(fallbackInstance),
  };
}
