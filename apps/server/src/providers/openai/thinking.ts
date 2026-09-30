import { type CustomModelEntry, findCustomModel } from "@nakama/core";
import { getModelById } from "../models";

/** OpenAI ids known not to accept the `reasoning` request parameter. */
const THINKING_DENY_PREFIXES = [
  "gpt-4o",
  "gpt-4-",
  "gpt-3.5",
  "gpt-3",
] as const;

/** OpenAI ids that commonly support `reasoning` (checked after deny list). */
const THINKING_ALLOW_PREFIXES = ["gpt-5", "gpt-6", "o1", "o3", "o4"] as const;

export function openAIModelSupportsThinking(
  model: string,
  customModels?: CustomModelEntry[]
): boolean {
  const trimmed = model.trim();
  const custom = findCustomModel(customModels, trimmed);

  if (custom?.supportsThinking !== undefined) {
    return custom.supportsThinking;
  }

  const catalog = getModelById(trimmed);

  if (
    catalog?.provider === "openai" &&
    catalog.supportsThinking !== undefined
  ) {
    return catalog.supportsThinking;
  }

  const slug = trimmed.toLowerCase();

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

  // Unknown ids: omit reasoning to avoid upstream 400s.
  return false;
}

/** Models that reject `/v1/chat/completions` (Codex completion models). */
export function openAIModelRequiresResponsesApi(model: string): boolean {
  return model.trim().toLowerCase().includes("codex");
}

/**
 * gpt-5.4+ and gpt-6 reject function tools with reasoning on Chat Completions.
 * GPT-6 Astra cannot set reasoning to none, so route tools via Responses.
 */
export function openAIModelRejectsChatToolsWithReasoning(
  model: string
): boolean {
  const slug = model.trim().toLowerCase();
  // gpt-5.4 … gpt-5.9, gpt-5.10+, gpt-5.6-luna, etc.
  return (
    /^gpt-5\.(?:[4-9]|\d{2,})/.test(slug) ||
    (slug.startsWith("gpt-6") && !slug.startsWith("gpt-6-astra"))
  );
}
