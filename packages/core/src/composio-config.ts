import { join } from "node:path";
import { readEnvValue } from "./config";
import { parseIni, readTextOrNull, writeTextFile } from "./fs";
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
  const raw = await readTextOrNull(getComposioConfigPath());

  if (raw === null) {
    return null;
  }

  const values = parseIni(raw);
  const apiKey = values.api_key?.trim() ?? "";

  if (!apiKey) {
    return null;
  }

  return { apiKey };
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

async function writeComposioConfigFile(
  config: ComposioConfigFile
): Promise<void> {
  const lines = [
    "# Nakama Composio integration",
    `api_key=${config.apiKey}`,
    "",
  ];

  await writeTextFile(getComposioConfigPath(), lines.join("\n"), {
    ensureDir: getComposioConfigDir(),
  });
}

export async function saveComposioConfig(
  input: UpdateComposioSettingsInput
): Promise<ComposioSettingsPublic> {
  const existing = await loadComposioConfigFile();
  const apiKey =
    input.apiKey === undefined ? (existing?.apiKey ?? "") : input.apiKey.trim();

  if (!apiKey) {
    throw new Error("Composio API key is required.");
  }

  await writeComposioConfigFile({ apiKey });
  return toComposioSettingsPublic({ apiKey });
}
