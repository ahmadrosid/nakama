import {
  defaultOllamaBaseUrl,
  normalizeProviderInstanceLabel,
  type ProviderInstance,
  type ProviderName,
  resolveOllamaHostMode,
  type UserConfig,
} from "@nakama/core";
import type { StoredCodingAgentHarnessKind } from "@nakama/db";
import { CEREBRAS_CHAT_BASE_URL } from "../providers/cerebras";
import { readApiKeyForInstance } from "../providers/create";
import { FIREWORKS_INFERENCE_BASE_URL } from "../providers/fireworks";

const OPENCODE_GO_CHAT_BASE_URL = "https://opencode.ai/zen/go/v1";

import { resolveProfileProviderSelection } from "./provider-instance-helpers";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export interface CodingAgentProviderRouting {
  active: boolean;
  apiKey: string | null;
  baseUrl: string | null;
  compatible: boolean;
  configured: boolean;
  error: string | null;
  model: string | null;
  providerLabel: string | null;
  providerType: ProviderName | null;
}

const CLAUDE_CODE_PROVIDER_TYPES = new Set<ProviderName>(["anthropic"]);

const CODEX_PROVIDER_TYPES = new Set<ProviderName>([
  "openai",
  "openrouter",
  "deepseek",
  "cerebras",
  "fireworks",
  "openai_compatible",
  "ollama",
  "opencode_go",
]);

const OPENCODE_PROVIDER_TYPES = new Set<ProviderName>([
  "openai",
  "openrouter",
  "openai_compatible",
  "opencode_go",
  "deepseek",
  "cerebras",
  "fireworks",
  "ollama",
]);

const PI_PROVIDER_TYPES = new Set<ProviderName>([
  "anthropic",
  "openai",
  "openrouter",
  "openai_compatible",
  "opencode_go",
  "deepseek",
  "cerebras",
  "fireworks",
  "ollama",
]);

export function isProviderCompatibleWithHarness(
  providerType: ProviderName,
  harnessKind: StoredCodingAgentHarnessKind
): boolean {
  // Cursor Agent uses host Cursor auth — never Nakama provider passthrough.
  if (harnessKind === "cursor_agent") {
    return false;
  }

  if (harnessKind === "claude_code") {
    return CLAUDE_CODE_PROVIDER_TYPES.has(providerType);
  }

  if (harnessKind === "codex") {
    return CODEX_PROVIDER_TYPES.has(providerType);
  }

  if (harnessKind === "pi") {
    return PI_PROVIDER_TYPES.has(providerType);
  }

  return OPENCODE_PROVIDER_TYPES.has(providerType);
}

export function getProviderApiBaseUrl(
  instance: ProviderInstance,
  harnessKind: StoredCodingAgentHarnessKind
): string {
  const override = instance.baseUrl?.trim();

  if (instance.type === "anthropic") {
    return (override ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/$/, "");
  }

  if (instance.type === "openai") {
    return (override ?? DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  }

  if (instance.type === "openrouter") {
    return OPENROUTER_BASE_URL;
  }

  if (instance.type === "deepseek") {
    return (override ?? DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");
  }

  if (instance.type === "cerebras") {
    return CEREBRAS_CHAT_BASE_URL;
  }

  if (instance.type === "fireworks") {
    return FIREWORKS_INFERENCE_BASE_URL;
  }

  if (instance.type === "ollama") {
    const hostMode = resolveOllamaHostMode(instance);
    return (override ?? defaultOllamaBaseUrl(hostMode)).replace(/\/$/, "");
  }

  if (instance.type === "openai_compatible") {
    if (!override) {
      throw new Error("OpenAI-compatible provider requires a base URL.");
    }

    return override.replace(/\/$/, "");
  }

  if (instance.type === "opencode_go") {
    return harnessKind === "claude_code"
      ? OPENCODE_GO_CHAT_BASE_URL.replace(/\/v1$/, "")
      : OPENCODE_GO_CHAT_BASE_URL;
  }

  return (override ?? DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
}

function incompatibilityMessage(
  harnessKind: StoredCodingAgentHarnessKind,
  providerType: ProviderName
): string {
  if (harnessKind === "claude_code") {
    return `Claude Code requires an Anthropic provider (got ${providerType}). Configure an Anthropic provider in Settings → Provider.`;
  }

  if (harnessKind === "codex") {
    return `Codex does not support the ${providerType} provider. Choose a compatible provider in Settings → Provider.`;
  }

  if (harnessKind === "pi") {
    return `pi does not support the ${providerType} provider. Choose a compatible provider in Settings → Provider.`;
  }

  return `OpenCode does not support the ${providerType} provider. Choose a compatible provider in Settings → Provider.`;
}

export function resolveCodingAgentProviderRouting(options: {
  userConfig: UserConfig | null | undefined;
  profileModel: string | null | undefined;
  harnessKind: StoredCodingAgentHarnessKind;
  env?: Record<string, string | undefined>;
}): CodingAgentProviderRouting {
  const empty: CodingAgentProviderRouting = {
    active: false,
    apiKey: null,
    baseUrl: null,
    compatible: false,
    configured: false,
    error: null,
    model: null,
    providerLabel: null,
    providerType: null,
  };

  const resolved = resolveProfileProviderSelection({
    defaultProviderId: options.userConfig?.defaultProviderId,
    profileModel: options.profileModel,
    providers: options.userConfig?.providers ?? [],
  });

  if (!resolved) {
    return {
      ...empty,
      error: "No LLM provider is configured. Add one in Settings → Provider.",
    };
  }

  const { instance, model } = resolved;
  const providerLabel = normalizeProviderInstanceLabel(
    instance.type,
    instance.label,
    []
  );
  const compatible = isProviderCompatibleWithHarness(
    instance.type,
    options.harnessKind
  );

  if (!compatible) {
    return {
      ...empty,
      configured: true,
      error: incompatibilityMessage(options.harnessKind, instance.type),
      model,
      providerLabel,
      providerType: instance.type,
    };
  }

  const apiKey = readApiKeyForInstance(instance, options.env ?? process.env);

  if (
    !apiKey?.trim() &&
    instance.type !== "openai_compatible" &&
    instance.type !== "ollama"
  ) {
    return {
      ...empty,
      compatible: true,
      configured: true,
      error: `Provider "${providerLabel}" has no API key. Add one in Settings → Provider.`,
      model,
      providerLabel,
      providerType: instance.type,
    };
  }

  if (instance.type === "ollama" && !apiKey?.trim()) {
    const hostMode = resolveOllamaHostMode(instance);

    if (hostMode === "cloud" && !apiKey?.trim()) {
      return {
        ...empty,
        compatible: true,
        configured: true,
        error: "Ollama Cloud requires an API key in Settings → Provider.",
        model,
        providerLabel,
        providerType: instance.type,
      };
    }
  }

  let baseUrl: string;

  try {
    baseUrl = getProviderApiBaseUrl(instance, options.harnessKind);
  } catch (error) {
    return {
      ...empty,
      compatible: true,
      configured: true,
      error:
        error instanceof Error
          ? error.message
          : "Could not resolve provider base URL.",
      model,
      providerLabel,
      providerType: instance.type,
    };
  }

  return {
    active: true,
    apiKey: apiKey ?? "",
    baseUrl,
    compatible: true,
    configured: true,
    error: null,
    model,
    providerLabel,
    providerType: instance.type,
  };
}
