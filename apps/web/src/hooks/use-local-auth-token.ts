import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useRotateLocalAuthToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.rotateLocalAuthToken(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workerLogs }),
  });
}
