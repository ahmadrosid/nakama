import type { OllamaHostMode } from "./contract";

export type { OllamaHostMode };

export const OLLAMA_LOCAL_DEFAULT_BASE_URL = "http://localhost:11434/v1";
export const OLLAMA_CLOUD_DEFAULT_BASE_URL = "https://ollama.com/v1";

export function parseOllamaHostMode(value: string | undefined): OllamaHostMode | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "local" || normalized === "cloud") {
    return normalized;
  }

  return null;
}

export function defaultOllamaBaseUrl(hostMode: OllamaHostMode): string {
  return hostMode === "cloud" ? OLLAMA_CLOUD_DEFAULT_BASE_URL : OLLAMA_LOCAL_DEFAULT_BASE_URL;
}

export function defaultOllamaLabel(hostMode: OllamaHostMode): string {
  return hostMode === "cloud" ? "Ollama Cloud" : "Ollama";
}

export function resolveOllamaHostMode(instance: {
  hostMode?: OllamaHostMode;
  baseUrl?: string;
}): OllamaHostMode {
  if (instance.hostMode) {
    return instance.hostMode;
  }

  const base = instance.baseUrl?.trim().toLowerCase() ?? "";

  if (base.includes("ollama.com")) {
    return "cloud";
  }

  return "local";
}

export function ollamaRequiresApiKey(hostMode: OllamaHostMode): boolean {
  return hostMode === "cloud";
}

export function isOllamaCloudInstance(instance: {
  type: string;
  hostMode?: OllamaHostMode;
  baseUrl?: string;
}): boolean {
  return instance.type === "ollama" && resolveOllamaHostMode(instance) === "cloud";
}
