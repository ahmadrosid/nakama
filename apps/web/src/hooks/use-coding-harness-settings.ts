import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CodingHarnessInstallRequest,
  UpdateCodingHarnessSettingsRequest,
  VerifyCodingHarnessRequest,
} from "@nakama/core/contract";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const codingHarnessSettingsQueryOptions = queryOptions({
  queryKey: queryKeys.codingHarnesses.settings,
  queryFn: () => client.getCodingHarnessSettings(),
});

export function useCodingHarnessSettings(enabled = true) {
  return useQuery({
    ...codingHarnessSettingsQueryOptions,
    enabled,
  });
}

export function useSaveCodingHarnessSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateCodingHarnessSettingsRequest) =>
      client.setCodingHarnessSettings(request),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.codingHarnesses.settings, saved);
    },
  });
}

export function useVerifyCodingHarness() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: VerifyCodingHarnessRequest) => client.verifyCodingHarness(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.codingHarnesses.settings,
      });
    },
  });
}

export function useInstallCodingHarness() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      request: CodingHarnessInstallRequest & {
        onProgress?: (message: string) => void;
      },
    ) => {
      const { onProgress, ...rest } = request;
      return client.installCodingHarness(rest, { onProgress });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.codingHarnesses.settings,
      });
    },
  });
}
