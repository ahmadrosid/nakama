import { join } from "node:path";
import { maskSecret } from "./email-config";
import { parseIni, readTextOrNull, writeTextFile } from "./fs";
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
  file: ComposioConfigFile | null | undefined
): string {
  return file?.apiKey?.trim() || "";
}

export function isComposioConfigured(
  file?: ComposioConfigFile | null
): boolean {
  return Boolean(resolveComposioApiKey(file));
}

export async function isComposioConfiguredAsync(): Promise<boolean> {
  return isComposioConfigured(await loadComposioConfigFile());
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
  file: ComposioConfigFile | null
): ComposioSettingsPublic {
  if (!file) {
    return {
      apiKeyMasked: null,
      configured: false,
    };
  }

  return {
    apiKeyMasked: maskSecret(file.apiKey),
    configured: Boolean(file.apiKey.trim()),
  };
}

export async function loadComposioSettingsPublic(): Promise<ComposioSettingsPublic> {
  return toComposioSettingsPublic(await loadComposioConfigFile());
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
