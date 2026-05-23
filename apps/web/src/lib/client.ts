import { createClient } from "@tinyclaw/client";

export const client = createClient({ baseUrl: "" });

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
