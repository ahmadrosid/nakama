import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  SendEmailTestRequest,
  UpdateEmailSettingsRequest,
} from "@nakama/core/contract";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const emailSettingsQueryOptions = queryOptions({
  queryKey: queryKeys.email.settings,
  queryFn: () => client.getEmailSettings(),
});

export function useEmailSettings() {
  return useQuery(emailSettingsQueryOptions);
}

export function useSaveEmailSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateEmailSettingsRequest) => client.setEmailSettings(request),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.email.settings, saved);
    },
  });
}

export function useSendEmailTest() {
  return useMutation({
    mutationFn: (request: SendEmailTestRequest = {}) => client.sendEmailTest(request),
  });
}
