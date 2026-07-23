import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isValidBaseUrl,
  normalizeBaseUrl,
  parseCustomModelsJson,
  serializeCustomModels,
  validateDisplayName,
} from "./compatible-provider-config";
import {
  defaultOllamaBaseUrl,
  defaultOllamaLabel,
  ollamaRequiresApiKey,
  parseOllamaHostMode,
  resolveOllamaHostMode,
} from "./ollama-provider-config";
import type {
  CustomModelEntry,
  ProviderChatOptions,
  ThinkingEffort,
  ThinkingSettings,
  TranscriptionSettings,
  VisionSettings,
} from "./contract";
import { ensureDir, readTextOrNull, writePrivateTextFile } from "./fs";
import {
  apiKeyEnvVarForProvider,
  parseProviderName,
  type UserProviderName,
} from "./provider-resolution";

export type { UserProviderName } from "./provider-resolution";
export {
  apiKeyEnvVarForProvider,
  parseProviderName,
  resolveProvider,
} from "./provider-resolution";

export interface ProviderInstance {
  id: string;
  type: UserProviderName;
  label: string;
  apiKey: string;
  baseUrl?: string;
  hostMode?: import("./contract").OllamaHostMode;
  customModels?: CustomModelEntry[];
  createdAt: string;
}

export interface UserConfig {
  defaultProviderId: string | null;
  providers: ProviderInstance[];
  timezone?: string;
  thinkingEnabled?: boolean;
  thinkingEffort?: ThinkingEffort;
  visionModel?: string | null;
  transcriptionModel?: string | null;
  localAuthTokenHash?: string;
  localAuthToken?: string;
}

export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_THINKING_ENABLED = true;
export const DEFAULT_THINKING_EFFORT: ThinkingEffort = "medium";

const PROVIDER_SECTION_PREFIX = "provider.";

const PROVIDER_TYPE_LABELS: Record<UserProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  cerebras: "Cerebras",
  ollama: "Ollama",
  openai_compatible: "Custom",
  opencode_go: "OpenCode Go",
};

export function createProviderInstanceId(): string {
  return crypto.randomUUID();
}

export function defaultProviderLabel(
  type: UserProviderName,
  existing: ProviderInstance[],
  options?: { hostMode?: import("./contract").OllamaHostMode },
): string {
  if (type === "ollama" && options?.hostMode) {
    const base = defaultOllamaLabel(options.hostMode);
    const sameMode = existing.filter(
      (entry) =>
        entry.type === "ollama" && resolveOllamaHostMode(entry) === options.hostMode,
    );

    if (sameMode.length === 0) {
      return base;
    }

    return `${base} (${sameMode.length + 1})`;
  }

  const base = PROVIDER_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
  const sameType = existing.filter((entry) => entry.type === type);

  if (sameType.length === 0) {
    return base;
  }

  return `${base} (${sameType.length + 1})`;
}

export function normalizeProviderInstanceLabel(
  type: UserProviderName,
  label: string | undefined,
  existing: ProviderInstance[],
  options?: { hostMode?: import("./contract").OllamaHostMode },
): string {
  const trimmed = label?.trim();

  if (trimmed && trimmed !== "undefined") {
    return trimmed;
  }

  return defaultProviderLabel(type, existing, options);
}

export function findProviderInstance(
  config: UserConfig | null | undefined,
  providerId: string,
): ProviderInstance | null {
  return config?.providers.find((entry) => entry.id === providerId) ?? null;
}

export function getActiveProviderInstance(
  config: UserConfig | null | undefined,
): ProviderInstance | null {
  if (!config?.defaultProviderId) {
    return null;
  }

  return findProviderInstance(config, config.defaultProviderId);
}

export function isProviderConfigured(
  config: UserConfig | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const active = getActiveProviderInstance(config);

  if (!active) {
    return false;
  }

  if (active.type === "openai_compatible") {
    return Boolean(active.baseUrl?.trim() && active.label.trim());
  }

  if (active.type === "ollama") {
    const hostMode = resolveOllamaHostMode(active);
    const baseUrl = active.baseUrl?.trim() || defaultOllamaBaseUrl(hostMode);

    if (!baseUrl) {
      return false;
    }

    if (ollamaRequiresApiKey(hostMode)) {
      if (active.apiKey.trim()) {
        return true;
      }

      const envVar = apiKeyEnvVarForProvider(active.type);
      return Boolean(envVar && env[envVar]?.trim());
    }

    return true;
  }

  if (active.apiKey.trim()) {
    return true;
  }

  const envVar = apiKeyEnvVarForProvider(active.type);
  return Boolean(envVar && env[envVar]?.trim());
}

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
  const override = process.env.NAKAMA_CONFIG_DIR?.trim();

  if (override) {
    return override;
  }

  return join(homedir(), ".nakama");
}

export function getUserConfigPath(): string {
  return join(getUserConfigDir(), "config.ini");
}

export async function ensureUserConfigDir(): Promise<string> {
  const dir = getUserConfigDir();
  await ensureDir(dir);
  return dir;
}

export async function loadUserConfig(): Promise<UserConfig | null> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return null;
  }

  const parsed = parseIniWithSections(raw);
  const thinking = readThinkingSettings(parsed.global);
  const timezone = readTimezone(parsed.global);
  const providers = loadProvidersFromSections(parsed.sections);

  return {
    defaultProviderId: parsed.global.default_provider_id?.trim() || null,
    providers,
    ...(timezone ? { timezone } : {}),
    thinkingEnabled: thinking.enabled,
    thinkingEffort: thinking.effort,
    visionModel: readVisionModel(parsed.global),
    transcriptionModel: readTranscriptionModel(parsed.global),
    ...(parsed.global.local_auth_token_hash?.trim()
      ? { localAuthTokenHash: parsed.global.local_auth_token_hash.trim() }
      : {}),
    ...(parsed.global.local_auth_token?.trim()
      ? { localAuthToken: parsed.global.local_auth_token.trim() }
      : {}),
  };
}

export async function loadUserTimezone(): Promise<string> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return DEFAULT_TIMEZONE;
  }

  return readTimezone(parseIniWithSections(raw).global) ?? DEFAULT_TIMEZONE;
}

function readVisionModel(global: Record<string, string>): string | null {
  const trimmed = global.vision_model?.trim();
  return trimmed ? trimmed : null;
}

function readTranscriptionModel(global: Record<string, string>): string | null {
  const trimmed = global.transcription_model?.trim();
  return trimmed ? trimmed : null;
}

export async function loadUserVisionSettings(): Promise<VisionSettings> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return { model: null };
  }

  return { model: readVisionModel(parseIniWithSections(raw).global) };
}

export async function saveUserVisionSettings(settings: VisionSettings): Promise<void> {
  const model = settings.model?.trim() || null;
  const existing = await loadUserConfig();

  if (existing) {
    await saveUserConfig({ ...existing, visionModel: model });
    return;
  }

  const raw = await readTextOrNull(getUserConfigPath());
  const parsed = raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);
  const lines = buildConfigIniLines(parsed.global, parsed.sections, {
    vision_model: model ?? "",
  });

  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

export async function loadUserTranscriptionSettings(): Promise<TranscriptionSettings> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return { model: null };
  }

  return { model: readTranscriptionModel(parseIniWithSections(raw).global) };
}

export async function loadUserThinkingSettings(): Promise<ThinkingSettings> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return {
      enabled: DEFAULT_THINKING_ENABLED,
      effort: DEFAULT_THINKING_EFFORT,
    };
  }

  return readThinkingSettings(parseIniWithSections(raw).global);
}

export async function saveUserThinkingSettings(
  settings: ThinkingSettings,
): Promise<void> {
  const effort = validateThinkingEffort(settings.effort);
  const enabled = settings.enabled;
  const existing = await loadUserConfig();

  if (existing) {
    await saveUserConfig({
      ...existing,
      thinkingEnabled: enabled,
      thinkingEffort: effort,
    });
    return;
  }

  const raw = await readTextOrNull(getUserConfigPath());
  const parsed = raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);
  const lines = buildConfigIniLines(parsed.global, parsed.sections, {
    thinking: enabled ? "on" : "off",
    thinking_effort: effort,
  });

  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

export function buildThinkingProviderOptions(
  config: Pick<UserConfig, "thinkingEnabled" | "thinkingEffort"> | null,
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

  if (existing) {
    await saveUserConfig({ ...existing, timezone: trimmed });
    return;
  }

  const raw = await readTextOrNull(getUserConfigPath());
  const parsed = raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);
  const lines = buildConfigIniLines(parsed.global, parsed.sections, {
    timezone: trimmed,
  });

  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

function readWebPublicUrl(values: Record<string, string>): string | undefined {
  const trimmed = values.web_public_url?.trim();
  return trimmed && isValidBaseUrl(trimmed) ? normalizeBaseUrl(new URL(trimmed).origin) : undefined;
}

export function readUserWebPublicUrlSync(): string | null {
  try {
    const raw = readFileSync(getUserConfigPath(), "utf8");
    return readWebPublicUrl(parseIniWithSections(raw).global) ?? null;
  } catch {
    return null;
  }
}

export async function loadUserWebPublicUrl(): Promise<string | null> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return null;
  }

  return readWebPublicUrl(parseIniWithSections(raw).global) ?? null;
}

export async function saveUserWebPublicUrl(webPublicUrl: string): Promise<string> {
  const trimmed = webPublicUrl.trim();

  if (!trimmed || !isValidBaseUrl(trimmed)) {
    throw new Error("webPublicUrl must be a valid http or https URL.");
  }

  const normalized = normalizeBaseUrl(new URL(trimmed).origin);
  const existing = await loadUserConfig();

  if (existing) {
    const raw = await readTextOrNull(getUserConfigPath());
    const parsed = raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);
    await writeParsedConfigIni(parsed.global, parsed.sections, {
      web_public_url: normalized,
    });
    return normalized;
  }

  const raw = await readTextOrNull(getUserConfigPath());
  const parsed = raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);
  const lines = buildConfigIniLines(parsed.global, parsed.sections, {
    web_public_url: normalized,
  });

  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });

  return normalized;
}

export async function saveUserConfig(config: UserConfig): Promise<void> {
  const raw = await readTextOrNull(getUserConfigPath());
  const existingParsed =
    raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);

  const thinking = readThinkingSettings({
    thinking: config.thinkingEnabled === false ? "off" : "on",
    thinking_effort: config.thinkingEffort ?? DEFAULT_THINKING_EFFORT,
  });

  const global: Record<string, string | undefined> = {
    ...existingParsed.global,
    default_provider_id: config.defaultProviderId ?? "",
    timezone: config.timezone,
    thinking: thinking.enabled ? "on" : "off",
    thinking_effort: thinking.effort,
    vision_model: config.visionModel ?? "",
    transcription_model: config.transcriptionModel ?? "",
    local_auth_token_hash: config.localAuthTokenHash,
  };

  const sections: Record<string, Record<string, string>> = {};
  for (const [sectionName, values] of Object.entries(existingParsed.sections)) {
    if (!sectionName.startsWith(PROVIDER_SECTION_PREFIX)) {
      sections[sectionName] = { ...values };
    }
  }

  const providers = config.providers.map((provider, index) => ({
    ...provider,
    label: normalizeProviderInstanceLabel(
      provider.type,
      provider.label,
      config.providers.slice(0, index),
    ),
  }));

  for (const provider of providers) {
    const sectionName = `${PROVIDER_SECTION_PREFIX}${provider.id}`;
    sections[sectionName] = buildProviderSectionValues(provider);
  }

  await writeParsedConfigIni(global, sections);
}

export async function writeParsedConfigIni(
  global: Record<string, string | undefined>,
  sections: Record<string, Record<string, string>>,
  patch: Record<string, string | undefined> = {},
): Promise<void> {
  const lines = buildConfigIniLines(global, sections, patch);
  await writePrivateTextFile(getUserConfigPath(), lines.join("\n"), {
    ensureDir: getUserConfigDir(),
  });
}

interface ParsedIniFile {
  global: Record<string, string>;
  sections: Record<string, Record<string, string>>;
}

export function parseIniWithSections(raw: string): ParsedIniFile {
  const global: Record<string, string> = {};
  const sections: Record<string, Record<string, string>> = {};
  let currentSection: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      sections[currentSection] ??= {};
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    if (currentSection) {
      sections[currentSection]![key] = value;
    } else {
      global[key] = value;
    }
  }

  return { global, sections };
}

function loadProvidersFromSections(
  sections: Record<string, Record<string, string>>,
): ProviderInstance[] {
  const providers: ProviderInstance[] = [];

  for (const [sectionName, values] of Object.entries(sections)) {
    if (!sectionName.startsWith(PROVIDER_SECTION_PREFIX)) {
      continue;
    }

    const id = sectionName.slice(PROVIDER_SECTION_PREFIX.length).trim();
    const type = parseProviderName(values.type);

    if (!id || !type) {
      continue;
    }

    const label = normalizeProviderInstanceLabel(type, values.label, providers);
    const apiKey = values.api_key ?? "";
    const baseUrl = values.base_url?.trim()
      ? normalizeBaseUrl(values.base_url)
      : undefined;
    const customModels =
      type === "openai_compatible" ||
      type === "openrouter" ||
      type === "cerebras" ||
      type === "ollama" ||
      type === "opencode_go"
        ? parseCustomModelsJson(values.models_json)
        : undefined;
    const hostMode = type === "ollama" ? parseOllamaHostMode(values.host_mode) ?? undefined : undefined;
    const createdAt = values.created_at?.trim() || new Date(0).toISOString();

    providers.push({
      id,
      type,
      label,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      ...(hostMode ? { hostMode } : {}),
      ...(customModels ? { customModels } : {}),
      createdAt,
    });
  }

  return providers.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function buildProviderSectionValues(provider: ProviderInstance): Record<string, string> {
  const values: Record<string, string> = {
    type: provider.type,
    label: normalizeProviderInstanceLabel(provider.type, provider.label, []),
    api_key: provider.apiKey,
    created_at: provider.createdAt,
  };

  if (provider.baseUrl?.trim()) {
    values.base_url = normalizeBaseUrl(provider.baseUrl);
  }

  if (provider.type === "ollama" && provider.hostMode) {
    values.host_mode = provider.hostMode;
  }

  if (provider.customModels?.length) {
    values.models_json = serializeCustomModels(provider.customModels);
  }

  return values;
}

function buildConfigIniLines(
  global: Record<string, string | undefined>,
  sections: Record<string, Record<string, string>>,
  patch: Record<string, string | undefined> = {},
): string[] {
  const mergedGlobal = { ...global, ...patch };
  const lines = ["# Nakama user config"];

  if (mergedGlobal.default_provider_id !== undefined) {
    lines.push(`default_provider_id=${mergedGlobal.default_provider_id.trim()}`);
  }

  if (mergedGlobal.timezone?.trim()) {
    lines.push(`timezone=${mergedGlobal.timezone.trim()}`);
  }

  if (mergedGlobal.web_public_url?.trim()) {
    lines.push(`web_public_url=${mergedGlobal.web_public_url.trim()}`);
  }

  const thinkingEnabled =
    mergedGlobal.thinking === undefined
      ? DEFAULT_THINKING_ENABLED
      : mergedGlobal.thinking.trim().toLowerCase() !== "off";
  lines.push(`thinking=${thinkingEnabled ? "on" : "off"}`);

  const effort = validateThinkingEffort(
    mergedGlobal.thinking_effort?.trim() as ThinkingEffort | undefined,
  );
  lines.push(`thinking_effort=${effort}`);

  if (mergedGlobal.local_auth_token_hash?.trim()) {
    lines.push(`local_auth_token_hash=${mergedGlobal.local_auth_token_hash.trim()}`);
  }

  lines.push("");

  for (const [sectionName, values] of Object.entries(sections)) {
    lines.push(`[${sectionName}]`);

    for (const [key, value] of Object.entries(values)) {
      lines.push(`${key}=${value}`);
    }

    lines.push("");
  }

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

export function validateProviderInstanceLabel(
  label: string,
  type: UserProviderName,
): string {
  const trimmed = label.trim();

  if (!trimmed) {
    if (type === "openai_compatible") {
      throw new Error("Provider name is required.");
    }

    throw new Error("Provider label is required.");
  }

  if (type === "openai_compatible") {
    return validateDisplayName(trimmed);
  }

  return trimmed;
}
