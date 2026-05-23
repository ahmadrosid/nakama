import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type UserProviderName = "openai" | "anthropic";

export interface UserProviderConfig {
  provider: UserProviderName;
  apiKey: string;
  model?: string;
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
      return null;
    }

    const model = values.model?.trim();
    const configuredProvider = values.provider?.toLowerCase();
    const provider =
      configuredProvider === "openai" || configuredProvider === "anthropic"
        ? configuredProvider
        : inferProviderFromApiKey(apiKey);

    return {
      provider,
      apiKey,
      ...(model ? { model } : {}),
    };
  } catch {
    return null;
  }
}

export async function saveUserConfig(config: UserProviderConfig): Promise<void> {
  const dir = getUserConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const lines = [
    "# TinyClaw user config",
    `provider=${config.provider}`,
    `api_key=${config.apiKey}`,
    `model=${config.model ?? ""}`,
    "",
  ];

  const path = getUserConfigPath();
  await writeFile(path, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
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
