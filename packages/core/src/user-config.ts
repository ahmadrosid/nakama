import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function inferProviderFromApiKey(apiKey: string): UserProviderName {
  if (apiKey.trim().startsWith("sk-ant-")) {
    return "anthropic";
  }

  return "openai";
}

export function getUserConfigDir(): string {
  return join(homedir(), ".tinyclaw");
}

export function getUserConfigPath(): string {
  return join(getUserConfigDir(), "config.ini");
}

export async function loadUserConfig(): Promise<UserProviderConfig | null> {
  try {
    const raw = await readFile(getUserConfigPath(), "utf8");
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
  } catch {
    return null;
  }
}

export async function loadUserTimezone(): Promise<string> {
  try {
    const raw = await readFile(getUserConfigPath(), "utf8");
    const values = parseIni(raw);
    return readTimezone(values) ?? DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
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

  const dir = getUserConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const lines = [
    "# TinyClaw user config",
    `timezone=${trimmed}`,
    "",
  ];

  const path = getUserConfigPath();
  await writeFile(path, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

export async function saveUserConfig(config: UserProviderConfig): Promise<void> {
  const dir = getUserConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const lines = [
    "# TinyClaw user config",
    `provider=${config.provider}`,
    `api_key=${config.apiKey}`,
    `model=${config.model ?? ""}`,
    ...(config.timezone ? [`timezone=${config.timezone}`] : []),
    "",
  ];

  const path = getUserConfigPath();
  await writeFile(path, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
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
