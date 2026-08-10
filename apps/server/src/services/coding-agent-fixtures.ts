import type { ProviderInstance } from "@nakama/core";
import type { CodingAgentProviderRouting } from "./coding-agent-provider-routing";

export function inactiveRouting(): CodingAgentProviderRouting {
  return {
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
}

export function activeAnthropicRouting(
  overrides: Partial<CodingAgentProviderRouting> = {}
): CodingAgentProviderRouting {
  return {
    active: true,
    apiKey: "sk-ant-test",
    baseUrl: "https://api.anthropic.com",
    compatible: true,
    configured: true,
    error: null,
    model: "claude-sonnet-4-6",
    providerLabel: "Anthropic",
    providerType: "anthropic",
    ...overrides,
  };
}

export function makeAnthropicProvider(
  overrides: Partial<ProviderInstance> = {}
): ProviderInstance {
  return {
    apiKey: "sk-ant-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "prov_anthropic",
    label: "Anthropic",
    type: "anthropic",
    ...overrides,
  };
}
