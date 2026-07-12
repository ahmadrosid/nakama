import { readEnvValue } from "./config";

export const COMPOSIO_API_KEY_ENV = "COMPOSIO_API_KEY";

export function isComposioConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(readEnvValue(env, COMPOSIO_API_KEY_ENV));
}

export function composioOrgUserId(orgId: string): string {
  return `nakama:org:${orgId}`;
}
