import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  CEREBRAS_FALLBACK_MODELS,
  CEREBRAS_MODELS_URL,
  normalizeCerebrasModels,
  type CerebrasModelRow,
  type CerebrasModelsApiResponse,
} from "@/lib/cerebras-models";
import { queryKeys } from "@/lib/query-keys";

async function fetchCerebrasModels(): Promise<{
  rows: CerebrasModelRow[];
  usedFallback: boolean;
}> {
  try {
    const res = await fetch(CEREBRAS_MODELS_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as CerebrasModelsApiResponse;
    const rows = normalizeCerebrasModels(data);
    if (rows.length === 0) {
      return { rows: CEREBRAS_FALLBACK_MODELS, usedFallback: true };
    }

    return { rows, usedFallback: false };
  } catch {
    return { rows: CEREBRAS_FALLBACK_MODELS, usedFallback: true };
  }
}

export const cerebrasModelsQueryOptions = queryOptions({
  queryKey: queryKeys.cerebrasModels,
  queryFn: fetchCerebrasModels,
  staleTime: 1000 * 60 * 30,
});

export function useCerebrasModels() {
  return useQuery(cerebrasModelsQueryOptions);
}
