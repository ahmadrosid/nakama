import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

export function useRotateLocalAuthToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.rotateLocalAuthToken(),
    onSuccess: () => invalidateQueries(queryClient, queryKeys.workerLogs),
  });
}
