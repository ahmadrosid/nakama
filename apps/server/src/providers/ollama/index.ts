import {
  defaultOllamaBaseUrl,
  defaultOllamaLabel,
  normalizeBaseUrl,
  resolveOllamaHostMode,
  type ProviderClient,
  type ProviderInstance,
} from "@nakama/core";
import { createOpenAICompatibleProvider } from "../openai-compatible";
import { compatibleModelSupportsThinking } from "../compatible-models";

export { fetchOllamaModels } from "./models";

export function resolveOllamaBaseUrl(instance: ProviderInstance | null | undefined): string {
  const trimmed = instance?.baseUrl?.trim();
  if (trimmed) {
    return normalizeBaseUrl(trimmed);
  }

  return defaultOllamaBaseUrl(resolveOllamaHostMode(instance ?? {}));
}

export function createOllamaProvider(options: {
  apiKey: string;
  model: string;
  instance?: ProviderInstance | null;
}): ProviderClient {
  const instance = options.instance;
  const hostMode = resolveOllamaHostMode(instance ?? {});
  const apiKey = options.apiKey.trim() || (hostMode === "local" ? "not-needed" : "");

  if (hostMode === "cloud" && !apiKey) {
    throw new Error("Ollama Cloud requires an API key.");
  }

  return createOpenAICompatibleProvider({
    apiKey,
    baseUrl: resolveOllamaBaseUrl(instance),
    model: options.model,
    displayName: instance?.label?.trim() || defaultOllamaLabel(hostMode),
    supportsThinking: compatibleModelSupportsThinking(options.model, instance?.customModels),
    providerName: "ollama",
  });
}
