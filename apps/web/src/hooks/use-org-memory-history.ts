import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

function invalidateOrgMemoryQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.orgMemory(orgId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.orgMemoryHistory(orgId) }),
  ]);
}

export function useOrgMemoryHistory(orgId: string | null) {
  return useQuery({
    queryKey: queryKeys.orgMemoryHistory(orgId ?? ""),
    queryFn: () => client.listOrgMemoryHistory(orgId ?? ""),
    enabled: Boolean(orgId),
  });
}

export function useOrgMemoryHistoryRevision(orgId: string, revisionId: string | null) {
  return useQuery({
    queryKey: queryKeys.orgMemoryHistoryRevision(orgId, revisionId ?? ""),
    queryFn: () => client.getOrgMemoryHistoryRevision(orgId, revisionId!),
    enabled: Boolean(orgId && revisionId),
  });
}

export function useRestoreOrgMemoryHistory(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) => client.restoreOrgMemoryHistory(orgId, revisionId),
    onSuccess: () => invalidateOrgMemoryQueries(queryClient, orgId),
  });
}

export function useUndoOrgMemoryChange(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.undoOrgMemoryChange(orgId),
    onSuccess: () => invalidateOrgMemoryQueries(queryClient, orgId),
  });
}
