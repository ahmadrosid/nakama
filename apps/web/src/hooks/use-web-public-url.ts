import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const webPublicUrlQueryOptions = queryOptions({
  queryFn: () => client.getWebPublicUrl(),
  queryKey: queryKeys.webPublicUrl,
});

export function useWebPublicUrlSettings() {
  return useQuery(webPublicUrlQueryOptions);
}

export function useSaveWebPublicUrl() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (webPublicUrl: string) =>
      client.updateWebPublicUrl(webPublicUrl),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.webPublicUrl });
    },
  });
}
