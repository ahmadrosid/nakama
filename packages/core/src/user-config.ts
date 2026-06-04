import { homedir } from "node:os";
import { join } from "node:path";
import {
  normalizeBaseUrl,
  parseCustomModelsJson,
  serializeCustomModels,
  validateDisplayName,
} from "./compatible-provider-config";
import type {
  CustomModelEntry,
  ProviderChatOptions,
  ThinkingEffort,
  ThinkingSettings,
} from "./contract";
import { parseIni, readTextOrNull, writePrivateTextFile } from "./fs";
import {
  parseProviderName,
  type UserProviderName,
} from "./provider-resolution";

export type { UserProviderName } from "./provider-resolution";
export {
  apiKeyEnvVarForProvider,
  parseProviderName,
  resolveProvider,
} from "./provider-resolution";

export interface UserProviderConfig {
  provider: UserProviderName;
  apiKey: string;
  model?: string;
  displayName?: string;
  baseUrl?: string;
  customModels?: CustomModelEntry[];
  timezone?: string;
  thinkingEnabled?: boolean;
  thinkingEffort?: ThinkingEffort;
}

export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_THINKING_ENABLED = true;
export const DEFAULT_THINKING_EFFORT: ThinkingEffort = "medium";

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
  const provider = parseProviderName(values.provider);

  if (!provider) {
    return null;
  }

  const apiKey = values.api_key ?? "";

  if (!apiKey.trim() && provider !== "openai_compatible") {
    return null;
  }

  const model = values.model?.trim();
  const timezone = readTimezone(values);
  const thinking = readThinkingSettings(values);
  const baseUrl = readBaseUrl(values);
  const compatible = readCompatibleProviderFields(provider, values);

  return {
    provider,
    apiKey,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...compatible,
    ...(timezone ? { timezone } : {}),
    thinkingEnabled: thinking.enabled,
    thinkingEffort: thinking.effort,
  };
}

export async function loadUserTimezone(): Promise<string> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return DEFAULT_TIMEZONE;
  }

  return readTimezone(parseIni(raw)) ?? DEFAULT_TIMEZONE;
}

export async function loadUserThinkingSettings(): Promise<ThinkingSettings> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return {
      enabled: DEFAULT_THINKING_ENABLED,
      effort: DEFAULT_THINKING_EFFORT,
    };
  }

  return readThinkingSettings(parseIni(raw));
}

export async function saveUserThinkingSettings(
  settings: ThinkingSettings,
): Promise<void> {
  const effort = validateThinkingEffort(settings.effort);
  const enabled = settings.enabled;
  const existing = await loadUserConfig();

  if (existing?.apiKey) {
    await saveUserConfig({
      ...existing,
      thinkingEnabled: enabled,
      thinkingEffort: effort,
    });
    return;
  }

  const raw = await readTextOrNull(getUserConfigPath());
  const values = raw === null ? {} : parseIni(raw);
  const lines = buildConfigIniLines({
    ...values,
    timezone: values.timezone,
    thinking: enabled ? "on" : "off",
    thinking_effort: effort,
  });

  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

export function buildThinkingProviderOptions(
  config: Pick<UserProviderConfig, "thinkingEnabled" | "thinkingEffort"> | null,
): ProviderChatOptions["thinking"] | undefined {
  const enabled = config?.thinkingEnabled ?? DEFAULT_THINKING_ENABLED;

  if (!enabled) {
    return undefined;
  }

  return {
    enabled: true,
    effort: config?.thinkingEffort ?? DEFAULT_THINKING_EFFORT,
  };
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

  const raw = await readTextOrNull(getUserConfigPath());
  const values = raw === null ? {} : parseIni(raw);
  const lines = buildConfigIniLines({
    ...values,
    timezone: trimmed,
  });

  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

export async function saveUserConfig(config: UserProviderConfig): Promise<void> {
  const thinking = readThinkingSettings({
    thinking: config.thinkingEnabled === false ? "off" : "on",
    thinking_effort: config.thinkingEffort ?? DEFAULT_THINKING_EFFORT,
  });
  const lines = buildConfigIniLines({
    provider: config.provider,
    api_key: config.apiKey,
    model: config.model ?? "",
    display_name: config.displayName,
    base_url: config.baseUrl,
    models_json:
      config.customModels?.length ? serializeCustomModels(config.customModels) : undefined,
    timezone: config.timezone,
    thinking: thinking.enabled ? "on" : "off",
    thinking_effort: thinking.effort,
  });

  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

function buildConfigIniLines(values: Record<string, string | undefined>): string[] {
  const lines = ["# TinyClaw user config"];

  if (values.provider?.trim()) {
    lines.push(`provider=${values.provider.trim()}`);
  }

  if (values.api_key?.trim()) {
    lines.push(`api_key=${values.api_key.trim()}`);
  }

  if (values.model !== undefined) {
    lines.push(`model=${values.model.trim()}`);
  }

  if (values.display_name?.trim()) {
    lines.push(`display_name=${values.display_name.trim()}`);
  }

  if (values.base_url?.trim()) {
    lines.push(`base_url=${normalizeBaseUrl(values.base_url)}`);
  }

  if (values.models_json?.trim()) {
    lines.push(`models_json=${values.models_json.trim()}`);
  }

  if (values.timezone?.trim()) {
    lines.push(`timezone=${values.timezone.trim()}`);
  }

  const thinkingEnabled =
    values.thinking === undefined
      ? DEFAULT_THINKING_ENABLED
      : values.thinking.trim().toLowerCase() !== "off";
  lines.push(`thinking=${thinkingEnabled ? "on" : "off"}`);

  const effort = validateThinkingEffort(
    values.thinking_effort?.trim() as ThinkingEffort | undefined,
  );
  lines.push(`thinking_effort=${effort}`);

  lines.push("");
  return lines;
}

function readThinkingSettings(values: Record<string, string>): ThinkingSettings {
  const raw = values.thinking?.trim().toLowerCase();

  return {
    enabled: raw === undefined ? DEFAULT_THINKING_ENABLED : raw !== "off",
    effort: validateThinkingEffort(values.thinking_effort?.trim() as ThinkingEffort | undefined),
  };
}

function validateThinkingEffort(value: ThinkingEffort | undefined): ThinkingEffort {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return DEFAULT_THINKING_EFFORT;
}

function readTimezone(values: Record<string, string>): string | undefined {
  const timezone = values.timezone?.trim();
  return timezone && isValidTimezone(timezone) ? timezone : undefined;
}

function readBaseUrl(values: Record<string, string>): string | undefined {
  return values.base_url?.trim() ? normalizeBaseUrl(values.base_url) : undefined;
}

function readCompatibleProviderFields(
  provider: UserProviderName,
  values: Record<string, string>,
): Pick<UserProviderConfig, "displayName" | "customModels"> {
  if (provider !== "openai_compatible") {
    return {};
  }

  const displayName = values.display_name?.trim()
    ? validateDisplayName(values.display_name)
    : undefined;
  const customModels = parseCustomModelsJson(values.models_json);

  return {
    ...(displayName ? { displayName } : {}),
    ...(customModels ? { customModels } : {}),
  };
}
