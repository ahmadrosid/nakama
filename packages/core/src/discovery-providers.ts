import type { ProviderName } from "./contract";

// Providers whose model lists are discovered live from the platform's
// /models endpoint and stored as instance custom models, instead of a
// hardcoded catalog. Adding a discovery-based provider is one entry here
// plus its type/env-key/label/base-URL wiring — no resolution edits.
export const DISCOVERY_MODEL_PROVIDERS: ReadonlySet<ProviderName> =
  new Set<ProviderName>(["openai_compatible", "minimax", "minimax_cn", "groq"]);

export function isDiscoveryModelProvider(provider: ProviderName): boolean {
  return DISCOVERY_MODEL_PROVIDERS.has(provider);
}
