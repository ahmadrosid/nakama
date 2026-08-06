import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  normalizeOpenRouterModels,
  type OpenRouterModelRow,
  type OpenRouterModelsApiResponse,
} from "@/lib/openrouter-models";
import { queryKeys } from "@/lib/query-keys";
import { client } from "@/lib/client";

async function fetchOpenRouterModels(): Promise<OpenRouterModelRow[]> {
  const data = (await client.getExternalModelCatalog("openrouter")) as OpenRouterModelsApiResponse;
  return normalizeOpenRouterModels(data);
}

export const openRouterModelsQueryOptions = queryOptions({
  queryKey: queryKeys.openRouterModels,
  queryFn: fetchOpenRouterModels,
  staleTime: 1000 * 60 * 30,
});

export function useOpenRouterModels() {
  return useQuery(openRouterModelsQueryOptions);
}
