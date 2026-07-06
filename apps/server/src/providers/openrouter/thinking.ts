import { findCustomModel, type CustomModelEntry } from "@nakama/core";

/** OpenRouter slugs known not to accept the `reasoning` request parameter. */
const THINKING_DENY_PREFIXES = [
  "meta-llama/",
  "meta/llama",
  "mistralai/",
  "google/gemma",
  "nvidia/",
  "microsoft/phi",
  "cohere/",
] as const;

/** OpenRouter slugs that commonly support `reasoning` (checked after deny list). */
const THINKING_ALLOW_PREFIXES = [
  "anthropic/claude-",
  "openai/o1",
  "openai/o3",
  "openai/o4",
  "openai/gpt-5",
  "google/gemini-2.5",
  "deepseek/deepseek-r1",
  "qwen/qwq",
] as const;

export function openRouterSlugSupportsThinking(model: string): boolean {
  const slug = model.trim().toLowerCase();

  for (const prefix of THINKING_DENY_PREFIXES) {
    if (slug.startsWith(prefix)) {
      return false;
    }
  }

  for (const prefix of THINKING_ALLOW_PREFIXES) {
    if (slug.startsWith(prefix)) {
      return true;
    }
  }

  // Unknown custom slugs: omit reasoning to avoid upstream 400s.
  return false;
}

export function openRouterModelSupportsThinking(
  model: string,
  customModels?: CustomModelEntry[],
): boolean {
  const trimmed = model.trim();
  const custom = findCustomModel(customModels, trimmed);

  if (custom?.supportsThinking !== undefined) {
    return custom.supportsThinking;
  }

  return openRouterSlugSupportsThinking(trimmed);
}
