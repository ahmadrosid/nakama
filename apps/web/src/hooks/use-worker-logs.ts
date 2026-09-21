import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useChannelProfileId } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useWorkerLogs(
  workerName: string,
  lines = 500,
  enabled = false
) {
  const profileId = useChannelProfileId();
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const api = client.forOrg(orgId);
  return useQuery({
    enabled,
    queryFn: () => api.getWorkerLogs(workerName, lines, profileId),
    queryKey: [
      ...queryKeys.workerLogs,
      workerName,
      orgId,
      ...(profileId ? [profileId] : []),
      lines,
    ],
  });
}

export function useClearWorkerLogs(workerName: string) {
  const profileId = useChannelProfileId();
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const api = client.forOrg(orgId);
  const queryKey = [
    ...queryKeys.workerLogs,
    workerName,
    orgId,
    ...(profileId ? [profileId] : []),
  ];
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.clearWorkerLogs(workerName, profileId),
    onMutate: () => queryKey,
    onSuccess: (_data, _variables, submittedQueryKey) => {
      queryClient.setQueriesData(
        { queryKey: submittedQueryKey },
        {
          stderr: "",
          stdout: "",
        }
      );
      void queryClient.invalidateQueries({
        queryKey: submittedQueryKey,
      });
    },
  });
}
