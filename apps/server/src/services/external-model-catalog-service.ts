const CATALOG_URLS = {
  "models-dev": "https://models.dev/api.json",
  openrouter: "https://openrouter.ai/api/v1/models?output_modalities=text",
  cerebras: "https://api.cerebras.ai/public/v1/models",
} as const;

export type ExternalModelCatalogId = keyof typeof CATALOG_URLS;

const CACHE_TTL_MS = 1000 * 60 * 30;

type CacheEntry = {
  fetchedAt: number;
  payload: unknown;
};

const cache = new Map<ExternalModelCatalogId, CacheEntry>();

export function isExternalModelCatalogId(value: string): value is ExternalModelCatalogId {
  return value in CATALOG_URLS;
}

export async function getExternalModelCatalog(catalogId: ExternalModelCatalogId): Promise<unknown> {
  const cached = cache.get(catalogId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.payload;
  }

  const response = await fetch(CATALOG_URLS[catalogId]);
  if (!response.ok) {
    throw new Error(`Failed to fetch model catalog (${response.status})`);
  }

  const payload = await response.json();
  cache.set(catalogId, { fetchedAt: Date.now(), payload });
  return payload;
}
