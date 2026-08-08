import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  CEREBRAS_FALLBACK_MODELS,
  type CerebrasModelRow,
  type CerebrasModelsApiResponse,
  normalizeCerebrasModels,
} from "@/lib/cerebras-models";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

async function fetchCerebrasModels(): Promise<{
  rows: CerebrasModelRow[];
  usedFallback: boolean;
}> {
  try {
    const data = (await client.getExternalModelCatalog(
      "cerebras"
    )) as CerebrasModelsApiResponse;
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
  queryFn: fetchCerebrasModels,
  queryKey: queryKeys.cerebrasModels,
  staleTime: 1000 * 60 * 30,
});

export function useCerebrasModels() {
  return useQuery(cerebrasModelsQueryOptions);
}
