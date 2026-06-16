import { QueryClient, type QueryCacheNotifyEvent } from "@tanstack/react-query";
import { TinyClawApiError } from "@tinyclaw/core/api-error";

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
  if (error instanceof TinyClawApiError && error.status === 401) {
    localStorage.removeItem("tinyclaw_auth_token");
    window.location.href = "/login";
  }
}
