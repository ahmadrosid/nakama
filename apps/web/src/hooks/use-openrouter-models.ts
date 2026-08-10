import { queryOptions, useQuery } from "@tanstack/react-query";
import { client } from "@/lib/client";
import {
  normalizeOpenRouterModels,
  type OpenRouterModelRow,
  type OpenRouterModelsApiResponse,
} from "@/lib/openrouter-models";
import { queryKeys } from "@/lib/query-keys";

async function fetchOpenRouterModels(): Promise<OpenRouterModelRow[]> {
  const data = (await client.getExternalModelCatalog(
    "openrouter"
  )) as OpenRouterModelsApiResponse;
  return normalizeOpenRouterModels(data);
}

export const openRouterModelsQueryOptions = queryOptions({
  queryFn: fetchOpenRouterModels,
  queryKey: queryKeys.openRouterModels,
  staleTime: 1000 * 60 * 30,
});

export function useOpenRouterModels() {
  return useQuery(openRouterModelsQueryOptions);
}
