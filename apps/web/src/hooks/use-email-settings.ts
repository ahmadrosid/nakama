import type {
  SendEmailTestRequest,
  UpdateEmailSettingsRequest,
} from "@nakama/core/contract";
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const emailSettingsQueryOptions = queryOptions({
  queryFn: () => client.getEmailSettings(),
  queryKey: queryKeys.email.settings,
});

export function useSaveEmailSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateEmailSettingsRequest) =>
      client.setEmailSettings(request),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.email.settings, saved);
    },
  });
}

export function useSendEmailTest() {
  return useMutation({
    mutationFn: (request: SendEmailTestRequest = {}) =>
      client.sendEmailTest(request),
  });
}
