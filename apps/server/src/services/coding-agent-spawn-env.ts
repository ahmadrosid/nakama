import type { ProviderName, UserConfig } from "@nakama/core";
import type { StoredCodingAgentHarnessKind } from "@nakama/db";
import {
  resolveCodingAgentProviderRouting,
  type CodingAgentProviderRouting,
} from "./coding-agent-provider-routing";
import {
  createHarnessConfigDir,
  writeCodexConfigToml,
  writeOpenCodeConfig,
  writePiModelsJson,
} from "./coding-agent-harness-config-files";

export function normalizeCodingAgentModel(model: string | null | undefined): string | null {
  if (!model?.trim()) {
    return null;
  }

  const trimmed = model.trim();
  const colonIndex = trimmed.indexOf(":");

  if (colonIndex >= 0) {
    const normalized = trimmed.slice(colonIndex + 1).trim();
    return normalized || null;
  }

  const slashIndex = trimmed.lastIndexOf("/");

  if (slashIndex >= 0) {
    const normalized = trimmed.slice(slashIndex + 1).trim();
    return normalized || null;
  }

  return trimmed;
}

export function formatModelForHarness(
  harnessKind: StoredCodingAgentHarnessKind,
  providerType: ProviderName,
  model: string,
): string {
  if (providerType === "openrouter" || providerType === "opencode_go") {
    return model.trim();
  }

  // pi sends the model ID directly to the provider's API. For openai_compatible
  // providers, the model ID may contain slashes (e.g. "cx/gpt-5.4") that are
  // part of the actual model name — stripping them would break routing.
  if (harnessKind === "pi") {
    if (providerType === "openai_compatible") {
      return model.trim();
    }
    // For known providers, only strip the "provider:" prefix (e.g. "anthropic:claude-sonnet-4-6"),
    // not slashes (e.g. "openrouter/anthropic/claude-sonnet-4-6").
    const colonIndex = model.indexOf(":");
    if (colonIndex >= 0) {
      return model.slice(colonIndex + 1).trim() || model.trim();
    }
    return model.trim();
  }

  if (harnessKind === "claude_code" && providerType === "anthropic") {
    return normalizeCodingAgentModel(model) ?? model.trim();
  }

  return normalizeCodingAgentModel(model) ?? model.trim();
}

export interface CodingAgentSpawnBundle {
  routing: ReturnType<typeof resolveCodingAgentProviderRouting>;
  spawn: CodingAgentSpawnEnvResult;
}

export async function resolveCodingAgentSpawnBundle(options: {
  userConfig: UserConfig | null | undefined;
  profileModel: string | null | undefined;
  harnessKind: StoredCodingAgentHarnessKind;
  env?: Record<string, string | undefined>;
}): Promise<CodingAgentSpawnBundle> {
  const routing = resolveCodingAgentProviderRouting({
    userConfig: options.userConfig,
    profileModel: options.profileModel,
    harnessKind: options.harnessKind,
    env: options.env,
  });

  const spawn = await buildSpawnEnvForHarness(
    options.harnessKind,
    routing,
    routing.providerType ?? "openai",
  );

  return { routing, spawn };
}

export interface CodingAgentSpawnEnvResult {
  env: Record<string, string>;
  cleanup?: () => Promise<void>;
}

export const CODING_AGENT_CREDENTIAL_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "PI_CODING_AGENT_DIR",
] as const;

/**
 * Maps a Nakama provider type to the pi CLI provider name.
 * pi has its own provider system with named providers (see `pi --list-models`).
 *
 * When the base URL is the default for the provider type, we use the built-in
 * pi provider name (e.g. "anthropic", "openai"). When the base URL is custom
 * (proxy/gateway), we use "nakama" — matching the custom provider entry in
 * models.json that uses the OpenAI Chat Completions API.
 */
const PI_PROVIDER_NAME: Partial<Record<ProviderName, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openrouter",
  openai_compatible: "nakama",
  opencode_go: "opencode",
  deepseek: "deepseek",
  cerebras: "cerebras",
  fireworks: "fireworks",
  ollama: "ollama",
};

const PI_DEFAULT_BASE_URLS: Partial<Record<ProviderName, string>> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com",
  cerebras: "https://api.cerebras.ai/v1",
  fireworks: "https://api.fireworks.ai/inference",
};

export function mapNakamaProviderToPi(
  providerType: ProviderName,
  baseUrl?: string | null,
): string | null {
  const builtinName = PI_PROVIDER_NAME[providerType];
  if (!builtinName) return null;

  // For providers with a non-default base URL (proxy/gateway), use the custom
  // "nakama" provider entry from models.json instead of the built-in provider.
  if (baseUrl) {
    const defaultUrl = PI_DEFAULT_BASE_URLS[providerType];
    if (defaultUrl && baseUrl.replace(/\/+$/, "") !== defaultUrl.replace(/\/+$/, "")) {
      return "nakama";
    }
  }

  return builtinName;
}

export function buildClaudeCodeSpawnEnv(
  routing: CodingAgentProviderRouting,
  providerType: ProviderName = "anthropic",
): Record<string, string> {
  if (!routing.active || !routing.baseUrl || !routing.apiKey) {
    return {};
  }

  const model = formatModelForHarness(
    "claude_code",
    providerType,
    routing.model ?? "claude-sonnet-4-6",
  );

  return {
    ANTHROPIC_BASE_URL: routing.baseUrl.replace(/\/$/, ""),
    ANTHROPIC_API_KEY: routing.apiKey,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_FEEDBACK_COMMAND: "1",
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

export function buildCodexSpawnEnv(
  routing: CodingAgentProviderRouting,
  providerType: ProviderName = "openai",
): Record<string, string> {
  if (!routing.active || !routing.baseUrl || !routing.apiKey) {
    return {};
  }

  const model = formatModelForHarness("codex", providerType, routing.model ?? "gpt-4.1");

  return {
    OPENAI_API_KEY: routing.apiKey,
    OPENAI_BASE_URL: routing.baseUrl.replace(/\/$/, ""),
    OPENAI_MODEL: model,
  };
}

export async function buildOpenCodeSpawnEnv(
  routing: CodingAgentProviderRouting,
  providerType: ProviderName = "openai",
): Promise<CodingAgentSpawnEnvResult> {
  if (!routing.active || !routing.baseUrl || !routing.apiKey) {
    return { env: {} };
  }

  const configDir = await createHarnessConfigDir("nakama-opencode-config-");
  await writeOpenCodeConfig(configDir.dir, routing, "opencode", providerType);

  return {
    env: {
      XDG_CONFIG_HOME: configDir.dir,
    },
    cleanup: configDir.cleanup,
  };
}

export async function buildPiSpawnEnv(
  routing: CodingAgentProviderRouting,
  providerType: ProviderName = "openai",
): Promise<CodingAgentSpawnEnvResult> {
  if (!routing.active || !routing.baseUrl || !routing.apiKey) {
    return { env: {} };
  }

  // pi does not read OPENAI_BASE_URL / ANTHROPIC_BASE_URL env vars.
  // The base URL is hardcoded per built-in provider and can only be overridden
  // via models.json in the pi config directory (PI_CODING_AGENT_DIR).
  // We create a temp config dir with a models.json that overrides the
  // provider's baseUrl + apiKey, then point pi to it.
  const configDir = await createHarnessConfigDir("nakama-pi-config-");
  await writePiModelsJson(configDir.dir, routing, providerType);

  return {
    env: {
      PI_CODING_AGENT_DIR: configDir.dir,
    },
    cleanup: configDir.cleanup,
  };
}

export async function buildSpawnEnvForHarness(
  kind: StoredCodingAgentHarnessKind,
  routing: CodingAgentProviderRouting,
  providerType: ProviderName = "openai",
): Promise<CodingAgentSpawnEnvResult> {
  // Cursor Agent uses host Cursor auth — never merge Nakama provider credentials.
  if (kind === "cursor_agent") {
    return { env: {} };
  }

  if (!routing.active) {
    return { env: {} };
  }

  if (kind === "claude_code") {
    return { env: buildClaudeCodeSpawnEnv(routing, providerType) };
  }

  if (kind === "pi") {
    return buildPiSpawnEnv(routing, providerType);
  }

  if (kind === "codex") {
    const env = buildCodexSpawnEnv(routing, providerType);

    if (Object.keys(env).length > 0) {
      return { env };
    }

    const configDir = await createHarnessConfigDir("nakama-codex-config-");
    await writeCodexConfigToml(configDir.dir, routing, "codex", providerType);

    return {
      env: {
        CODEX_HOME: configDir.dir,
        ...env,
      },
      cleanup: configDir.cleanup,
    };
  }

  return buildOpenCodeSpawnEnv(routing, providerType);
}

export function mergeCodingAgentSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  spawnEnv: Record<string, string>,
  options: { protectCredentialKeys?: boolean; callerEnv?: Record<string, string> } = {},
): NodeJS.ProcessEnv {
  const callerEnv = options.callerEnv ?? {};
  const merged: Record<string, string> = { ...spawnEnv };

  for (const [key, value] of Object.entries(callerEnv)) {
    if (
      options.protectCredentialKeys &&
      CODING_AGENT_CREDENTIAL_ENV_KEYS.includes(
        key as (typeof CODING_AGENT_CREDENTIAL_ENV_KEYS)[number],
      )
    ) {
      continue;
    }

    merged[key] = value;
  }

  return { ...baseEnv, ...merged };
}

export function redactSpawnEnvForPrompt(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (/(api[_-]?key|auth[_-]?token|secret)/i.test(key)) {
      redacted[key] = "***";
      continue;
    }

    if (/^sk-[A-Za-z0-9_-]+$/.test(value) || /^tc_local_/.test(value)) {
      redacted[key] = "***";
      continue;
    }

    redacted[key] = value;
  }

  return redacted;
}

export function redactSpawnEnvForApi(
  env: Record<string, string>,
  options: { includeSecrets: boolean },
): Record<string, string> {
  if (options.includeSecrets) {
    return { ...env };
  }

  return redactSpawnEnvForPrompt(env);
}
