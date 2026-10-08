import { queryOptions, useQuery } from "@tanstack/react-query";
import { client } from "@/lib/client";
import {
  normalizeOpenRouterModels,
  type OpenRouterModelRow,
  type OpenRouterModelsApiResponse,
} from "@/lib/openrouter-models";
import { queryKeys } from "@/lib/query-keys";

async function fetchOpenRouterModels(): Promise<OpenRouterModelRow[]> {
  // SAFETY: The enclosing parser checks the value before this conversion.
  const data = (await client.getExternalModelCatalog(
    "openrouter"
  )) as OpenRouterModelsApiResponse;

  return normalizeOpenRouterModels(data);
}

const openRouterModelsQueryOptions = queryOptions({
  queryFn: fetchOpenRouterModels,
  queryKey: queryKeys.openRouterModels,
  staleTime: 1000 * 60 * 30,
});

export function useOpenRouterModels() {
  return useQuery(openRouterModelsQueryOptions);
}
