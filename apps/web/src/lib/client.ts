import { createClient } from "@tinyclaw/client";
import { formatClientError } from "@tinyclaw/core/api-error";

export const client = createClient({ baseUrl: "" });

export function formatError(error: unknown): string {
  return formatClientError(error);
}
