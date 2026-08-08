import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useWorkerLogs(workerName: string, lines = 500) {
  return useQuery({
    enabled: false,
    queryFn: () => client.getWorkerLogs(workerName, lines),
    queryKey: [...queryKeys.workerLogs, workerName, lines],
  });
}

export function useClearWorkerLogs(workerName: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.clearWorkerLogs(workerName),
    onSuccess: () => {
      queryClient.setQueriesData(
        { queryKey: [...queryKeys.workerLogs, workerName] },
        {
          stderr: "",
          stdout: "",
        }
      );
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.workerLogs, workerName],
      });
    },
  });
}
