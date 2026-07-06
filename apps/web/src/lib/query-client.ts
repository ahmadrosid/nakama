import { QueryClient, type QueryCacheNotifyEvent } from "@tanstack/react-query";
import { NakamaApiError } from "@nakama/core/api-error";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function onGlobalQueryError(event: QueryCacheNotifyEvent) {
  const error = event.query?.state?.error;
  if (error instanceof NakamaApiError && error.status === 401) {
    window.location.href = "/login";
  }
}
