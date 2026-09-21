import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useChannelProfileId } from "@/hooks/use-app-queries";
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
  const profileId = useChannelProfileId();
  const { activeOrg } = useAuth();
  const api = client.forOrg(activeOrg?.id ?? null);
  return useWorkerMutation((name) => api.startWorker(name, profileId));
}

export function useStopWorker() {
  const profileId = useChannelProfileId();
  const { activeOrg } = useAuth();
  const api = client.forOrg(activeOrg?.id ?? null);
  return useWorkerMutation((name) => api.stopWorker(name, profileId));
}

export function useRestartWorker() {
  const profileId = useChannelProfileId();
  const { activeOrg } = useAuth();
  const api = client.forOrg(activeOrg?.id ?? null);
  return useWorkerMutation((name) => api.restartWorker(name, profileId));
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

export function useDisconnectChannel() {
  const profileId = useChannelProfileId();
  const { activeOrg } = useAuth();
  const api = client.forOrg(activeOrg?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => {
      if (!profileId) {
        throw new Error("Choose an agent connection");
      }
      return api.disconnectChannel(name, profileId);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
