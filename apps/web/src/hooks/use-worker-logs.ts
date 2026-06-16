import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useWorkerLogs(workerName: string, lines = 500) {
  return useQuery({
    queryKey: [...queryKeys.workerLogs, workerName, lines],
    queryFn: () => client.getWorkerLogs(workerName, lines),
    enabled: false,
  });
}

export function useClearWorkerLogs(workerName: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.clearWorkerLogs(workerName),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.workerLogs, workerName],
      });
    },
  });
}
