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
] as const;

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

export async function buildSpawnEnvForHarness(
  kind: StoredCodingAgentHarnessKind,
  routing: CodingAgentProviderRouting,
  providerType: ProviderName = "openai",
): Promise<CodingAgentSpawnEnvResult> {
  if (!routing.active) {
    return { env: {} };
  }

  if (kind === "claude_code") {
    return { env: buildClaudeCodeSpawnEnv(routing, providerType) };
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
