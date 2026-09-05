import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

function useWorkerMutation(mutationFn: (name: string) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.systemStatus });
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
