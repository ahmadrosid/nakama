import { homedir } from "node:os";
import { join } from "node:path";
import { readTextOrNull, writePrivateTextFile } from "./fs";

export type UserProviderName = "openai" | "anthropic";

export interface UserProviderConfig {
  provider: UserProviderName;
  apiKey: string;
  model?: string;
  timezone?: string;
}

export const DEFAULT_TIMEZONE = "UTC";

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function validateTimezone(
  timezone: string | undefined,
  fallback = DEFAULT_TIMEZONE,
): string {
  const value = timezone?.trim() || fallback;

  if (!isValidTimezone(value)) {
    throw new Error(`Invalid timezone: ${value}`);
  }

  return value;
}

export function inferProviderFromApiKey(apiKey: string): UserProviderName {
  if (apiKey.trim().startsWith("sk-ant-")) {
    return "anthropic";
  }

  return "openai";
}

export function getUserConfigDir(): string {
  const override = process.env.TINYCLAW_CONFIG_DIR?.trim();

  if (override) {
    return override;
  }

  return join(homedir(), ".tinyclaw");
}

export function getUserConfigPath(): string {
  return join(getUserConfigDir(), "config.ini");
}

export async function loadUserConfig(): Promise<UserProviderConfig | null> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return null;
  }

  const values = parseIni(raw);
  const apiKey = values.api_key?.trim();

  if (!apiKey) {
    return loadTimezoneOnlyConfig(values);
  }

  const model = values.model?.trim();
  const configuredProvider = values.provider?.toLowerCase();
  const provider =
    configuredProvider === "openai" || configuredProvider === "anthropic"
      ? configuredProvider
      : inferProviderFromApiKey(apiKey);
  const timezone = readTimezone(values);

  return {
    provider,
    apiKey,
    ...(model ? { model } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

export async function loadUserTimezone(): Promise<string> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return DEFAULT_TIMEZONE;
  }

  return readTimezone(parseIni(raw)) ?? DEFAULT_TIMEZONE;
}

export async function saveUserTimezone(timezone: string): Promise<void> {
  const trimmed = timezone.trim();

  if (!trimmed || !isValidTimezone(trimmed)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }

  const existing = await loadUserConfig();

  if (existing?.apiKey) {
    await saveUserConfig({ ...existing, timezone: trimmed });
    return;
  }

  const lines = [
    "# TinyClaw user config",
    `timezone=${trimmed}`,
    "",
  ];

  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

export async function saveUserConfig(config: UserProviderConfig): Promise<void> {
  const lines = [
    "# TinyClaw user config",
    `provider=${config.provider}`,
    `api_key=${config.apiKey}`,
    `model=${config.model ?? ""}`,
    ...(config.timezone ? [`timezone=${config.timezone}`] : []),
    "",
  ];

  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

function loadTimezoneOnlyConfig(values: Record<string, string>): UserProviderConfig | null {
  const timezone = readTimezone(values);

  if (!timezone) {
    return null;
  }

  return {
    provider: "openai",
    apiKey: "",
    timezone,
  };
}

function readTimezone(values: Record<string, string>): string | undefined {
  const timezone = values.timezone?.trim();
  return timezone && isValidTimezone(timezone) ? timezone : undefined;
}

function parseIni(raw: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    values[key] = value;
  }

  return values;
}
