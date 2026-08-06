import { normalizeBaseUrl, type CustomModelEntry } from "@nakama/core";
import { fetchRemoteOpenAIModels } from "../compatible-models";

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

function ollamaTagsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);

  try {
    const url = new URL(normalized);
    return `${url.origin}/api/tags`;
  } catch {
    return `${normalized.replace(/\/v1\/?$/, "")}/api/tags`;
  }
}

async function fetchOllamaTagsModels(
  baseUrl: string,
  apiKey: string,
): Promise<CustomModelEntry[]> {
  const response = await fetch(ollamaTagsUrl(baseUrl), {
    headers: {
      ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Could not fetch Ollama models from /api/tags (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as OllamaTagsResponse;
  const ids = (payload.models ?? [])
    .map((entry) => entry.name?.trim() || entry.model?.trim())
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) {
    throw new Error("Ollama /api/tags response did not include any model names.");
  }

  return [...new Set(ids)]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({ id, name: id }));
}

export async function fetchOllamaModels(
  baseUrl: string,
  apiKey = "",
): Promise<CustomModelEntry[]> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  try {
    const remote = await fetchRemoteOpenAIModels(normalizedBaseUrl, apiKey);

    if (remote.length > 0) {
      return remote;
    }
  } catch {
    // Fall through to native /api/tags.
  }

  return fetchOllamaTagsModels(normalizedBaseUrl, apiKey);
}
