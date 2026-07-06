import { createClient } from "@nakama/client";
import { formatClientError } from "@nakama/core/api-error";

export const client = createClient({ baseUrl: "" });

export function formatError(error: unknown): string {
  return formatClientError(error);
}
