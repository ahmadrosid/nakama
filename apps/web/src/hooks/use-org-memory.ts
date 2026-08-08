import type { UpdateOrgMemoryRequest } from "@nakama/core/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useOrgMemory(orgId: string | null) {
  return useQuery({
    enabled: Boolean(orgId),
    queryFn: () => client.getOrgMemory(orgId ?? ""),
    queryKey: queryKeys.orgMemory(orgId ?? ""),
  });
}

function invalidateOrgMemory(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.orgMemory(orgId) }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.orgMemoryHistory(orgId),
    }),
  ]);
}

export function useUpdateOrgMemory(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateOrgMemoryRequest) =>
      client.updateOrgMemory(orgId, request),
    onSuccess: () => invalidateOrgMemory(queryClient, orgId),
  });
}
