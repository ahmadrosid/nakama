import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

function invalidateOrgMemoryQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string
) {
  return invalidateQueries(
    queryClient,
    queryKeys.orgMemory(orgId),
    queryKeys.orgMemoryHistory(orgId)
  );
}

export function useOrgMemoryHistory(orgId: string | null) {
  return useQuery({
    enabled: Boolean(orgId),
    queryFn: () => client.listOrgMemoryHistory(orgId ?? ""),
    queryKey: queryKeys.orgMemoryHistory(orgId ?? ""),
  });
}

export function useOrgMemoryHistoryRevision(
  orgId: string,
  revisionId: string | null
) {
  return useQuery({
    enabled: Boolean(orgId && revisionId),
    queryFn: () => client.getOrgMemoryHistoryRevision(orgId, revisionId!),
    queryKey: queryKeys.orgMemoryHistoryRevision(orgId, revisionId ?? ""),
  });
}

export function useRestoreOrgMemoryHistory(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (revisionId: string) =>
      client.restoreOrgMemoryHistory(orgId, revisionId),
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
