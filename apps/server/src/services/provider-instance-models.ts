import { findCustomModel, type ProviderInstance } from "@nakama/core";
import {
  NETRA_AGENT_MODEL_ID,
  resolveNetraModelId,
} from "@nakama/core/discovery-providers";
import {
  getModelById,
  getModelsForProvider,
  getModelsForProviderInstance,
  isCompatibleModelId,
  isOpenRouterModelSlug,
} from "../providers";

export function modelExistsOnInstance(
  instance: ProviderInstance,
  modelId: string
): boolean {
  const trimmed = modelId.trim();

  if (!trimmed) {
    return false;
  }

  const catalog = getModelsForProviderInstance(instance);

  if (catalog.some((model) => model.id === trimmed)) {
    return true;
  }

  // Keep saved selections resolvable after retirement from the ChatGPT picker.
  if (
    instance.type === "chatgpt" &&
    (trimmed === "gpt-5.4" || trimmed === "gpt-5.4-mini")
  ) {
    return true;
  }

  if (instance.type === "openrouter" && isOpenRouterModelSlug(trimmed)) {
    return true;
  }

  if (instance.type === "cerebras") {
    if (instance.customModels?.length) {
      return findCustomModel(instance.customModels, trimmed) !== undefined;
    }

    return Boolean(getModelById(trimmed)?.provider === "cerebras");
  }

  if (instance.type === "fireworks") {
    if (instance.customModels?.length) {
      return findCustomModel(instance.customModels, trimmed) !== undefined;
    }

    return Boolean(getModelById(trimmed)?.provider === "fireworks");
  }

  if (instance.type === "ollama") {
    if (instance.customModels?.length) {
      return findCustomModel(instance.customModels, trimmed) !== undefined;
    }

    return false;
  }

  if (instance.type === "netra") {
    return (
      resolveNetraModelId(trimmed) === NETRA_AGENT_MODEL_ID &&
      (instance.customModels ?? []).some(
        (entry) => resolveNetraModelId(entry.id) === NETRA_AGENT_MODEL_ID
      )
    );
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
    (instance.type === "openai" ||
      instance.type === "chatgpt" ||
      instance.type === "anthropic" ||
      instance.type === "gemini" ||
      instance.type === "deepseek" ||
      instance.type === "doubao" ||
      instance.type === "vercel_ai_gateway" ||
      instance.type === "together" ||
      instance.type === "xiaomi" ||
      instance.type === "meta" ||
      instance.type === "mistral" ||
      instance.type === "qwen" ||
      instance.type === "qwen_cn" ||
      instance.type === "perplexity") &&
    instance.customModels?.length
  ) {
    return findCustomModel(instance.customModels, trimmed) !== undefined;
  }

  return getModelsForProvider(instance.type).some(
    (model) => model.id === trimmed
  );
}
