import type { ProviderName } from "./contract";

// Providers whose model lists are discovered live from the platform's
// /models endpoint and stored as instance custom models, instead of a
// hardcoded catalog. Adding a discovery-based provider is one entry here
// plus its type/env-key/label/base-URL wiring — no resolution edits.
//
// Browser-safe: type-imports only from ./contract. Do not import node-only
// modules here — the web settings card consumes this file.
export const DISCOVERY_MODEL_PROVIDERS: ReadonlySet<ProviderName> =
  new Set<ProviderName>([
    "openai_compatible",
    "minimax",
    "minimax_cn",
    "xai",
    "zhipu",
    "zhipu_cn",
  ]);

// Region-default base URLs. Families with split platforms (intl / CN) list
// one entry per variant; single-platform providers may omit an entry and
// declare their URL in the server factory instead.
export const DISCOVERY_PROVIDER_BASE_URLS: Readonly<
  Partial<Record<ProviderName, string>>
> = {
  minimax: "https://api.minimax.io/v1",
  minimax_cn: "https://api.minimaxi.com/v1",
  zhipu: "https://api.z.ai/api/paas/v4",
  zhipu_cn: "https://open.bigmodel.cn/api/paas/v4",
};

export function isDiscoveryModelProvider(provider: ProviderName): boolean {
  return DISCOVERY_MODEL_PROVIDERS.has(provider);
}

// Region-default base URL for a discovery provider, or null when the family
// has no fixed default (openai_compatible users supply their own endpoint).
export function defaultDiscoveryBaseUrl(provider: ProviderName): string | null {
  return DISCOVERY_PROVIDER_BASE_URLS[provider] ?? null;
}
