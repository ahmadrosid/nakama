import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

function useWorkerMutation(mutationFn: (name: string) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.systemStatus }),
        queryClient.invalidateQueries({ queryKey: ["plugin-workers"] }),
      ]);
    },
  });
}

export function useStartWorker() {
  return useWorkerMutation((name) => client.startWorker(name));
}

export function useStopWorker() {
  return useWorkerMutation((name) => client.stopWorker(name));
}

export function useRestartWorker() {
  return useWorkerMutation((name) => client.restartWorker(name));
}

export function usePluginWorkers() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id;
  return useQuery({
    enabled: Boolean(orgId) && activeOrg?.role !== "viewer",
    queryFn: () => client.listPluginWorkers(orgId),
    queryKey: ["plugin-workers", orgId],
    refetchInterval: 5000,
  });
}
