import type { ProviderInstance } from "@nakama/core";
import type { CodingAgentProviderRouting } from "./coding-agent-provider-routing";

export function inactiveRouting(): CodingAgentProviderRouting {
  return {
    configured: false,
    compatible: false,
    active: false,
    providerType: null,
    providerLabel: null,
    baseUrl: null,
    apiKey: null,
    model: null,
    error: null,
  };
}

export function activeAnthropicRouting(
  overrides: Partial<CodingAgentProviderRouting> = {},
): CodingAgentProviderRouting {
  return {
    configured: true,
    compatible: true,
    active: true,
    providerType: "anthropic",
    providerLabel: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-test",
    model: "claude-sonnet-4-6",
    error: null,
    ...overrides,
  };
}

export function makeAnthropicProvider(
  overrides: Partial<ProviderInstance> = {},
): ProviderInstance {
  return {
    id: "prov_anthropic",
    type: "anthropic",
    label: "Anthropic",
    apiKey: "sk-ant-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
