import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const timezoneCatalogStaleTime = 1000 * 60 * 60;

export const timezoneCatalogQueryOptions = queryOptions({
  queryKey: queryKeys.timezones.catalog,
  queryFn: () => client.listTimezones(),
  staleTime: timezoneCatalogStaleTime,
});

export const userTimezoneQueryOptions = queryOptions({
  queryKey: queryKeys.timezones.settings,
  queryFn: () => client.getTimezone(),
  staleTime: timezoneCatalogStaleTime,
});

export function prefetchTimezoneData(queryClient: QueryClient): void {
  void queryClient.prefetchQuery(timezoneCatalogQueryOptions);
  void queryClient.prefetchQuery(userTimezoneQueryOptions);
}

export function useTimezoneCatalog() {
  return useQuery(timezoneCatalogQueryOptions);
}

export function useUserTimezone() {
  return useQuery(userTimezoneQueryOptions);
}

export function useSaveUserTimezone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (timezone: string) => client.setTimezone(timezone),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.timezones.settings, saved);
    },
  });
}
