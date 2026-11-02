import type { ProviderName } from "./contract";

export const NETRA_AGENT_MODEL_ID = "deepseek/deepseek-v4.1-flash";

// Saved selections remain readable; never send the retired ID to Netra.
export function resolveNetraModelId(model: string): string {
  return model === "deepseek/deepseek-v4-flash-0731"
    ? NETRA_AGENT_MODEL_ID
    : model;
}

// Netra's /v1/models reports input_modalities ["text", "image"] for V4.1
// Flash. Saved entries predate that: tenant setup stores no flag, and older
// configs keep supportsVision false from the retired text-only 0731 model.
const NETRA_VISION_MODEL_IDS: ReadonlySet<string> = new Set([
  NETRA_AGENT_MODEL_ID,
]);

export function netraModelSupportsVision(model: string): boolean {
  return NETRA_VISION_MODEL_IDS.has(resolveNetraModelId(model.trim()));
}

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
    "netra",
    "minimax",
    "minimax_cn",
    "moonshot",
    "moonshot_cn",
    "xai",
    "groq",
    "cheaper_inference",
    "atmorouter",
    "zhipu",
    "zhipu_cn",
  ]);

// Region-default base URLs. Families with split platforms (intl / CN) list
// one entry per variant; single-platform providers may omit an entry and
// declare their URL in the server factory instead.
export const DISCOVERY_PROVIDER_BASE_URLS: Readonly<
  Partial<Record<ProviderName, string>>
> = {
  atmorouter: "https://atmorouter.dev/v1",
  cheaper_inference: "https://api.cheaperinference.com/v1",
  groq: "https://api.groq.com/openai/v1",
  minimax: "https://api.minimax.io/v1",
  minimax_cn: "https://api.minimaxi.com/v1",
  moonshot: "https://api.moonshot.ai/v1",
  moonshot_cn: "https://api.moonshot.cn/v1",
  netra: "https://api.netraruntime.com/v1",
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
