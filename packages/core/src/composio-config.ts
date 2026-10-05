import { join } from "node:path";
import { readEnvValue, resolveManagedSecret } from "./config";
import { maskTrailingSecret } from "./secret-mask";
import { getUserConfigDir } from "./user-config";

export interface ComposioConfigFile {
  apiKey: string;
}

export interface ComposioSettingsPublic {
  apiKeyMasked: string | null;
  configured: boolean;
}

export interface UpdateComposioSettingsInput {
  apiKey?: string;
}

export function getComposioConfigDir(): string {
  return join(getUserConfigDir(), "composio");
}

export function getComposioConfigPath(): string {
  return join(getComposioConfigDir(), "config.ini");
}

export function composioOrgUserId(orgId: string): string {
  return `nakama:org:${orgId}`;
}

export function composioUserId(userId: string): string {
  return `nakama:user:${userId}`;
}

export function resolveComposioApiKey(
  file: ComposioConfigFile | null | undefined,
  env: Record<string, string | undefined> = process.env
): string {
  return readEnvValue(env, "COMPOSIO_API_KEY") || file?.apiKey?.trim() || "";
}

export function isComposioConfigured(
  file?: ComposioConfigFile | null,
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(resolveComposioApiKey(file, env));
}

export async function isComposioConfiguredAsync(
  env: Record<string, string | undefined> = process.env
): Promise<boolean> {
  return isComposioConfigured(await loadComposioConfigFile(), env);
}

export async function loadComposioConfigFile(): Promise<ComposioConfigFile | null> {
  const apiKey = await resolveManagedSecret("global", "composio", [
    "COMPOSIO_API_KEY",
  ]);
  return apiKey ? { apiKey } : null;
}

export function toComposioSettingsPublic(
  file: ComposioConfigFile | null,
  env: Record<string, string | undefined> = process.env
): ComposioSettingsPublic {
  const apiKey = resolveComposioApiKey(file, env);

  if (!apiKey) {
    return {
      apiKeyMasked: null,
      configured: false,
    };
  }

  return {
    apiKeyMasked: maskTrailingSecret(apiKey),
    configured: true,
  };
}

export async function loadComposioSettingsPublic(
  env: Record<string, string | undefined> = process.env
): Promise<ComposioSettingsPublic> {
  return toComposioSettingsPublic(await loadComposioConfigFile(), env);
}

export async function saveComposioConfig(
  _input: UpdateComposioSettingsInput
): Promise<ComposioSettingsPublic> {
  throw new Error("Save the Composio key through the secret settings API.");
}
