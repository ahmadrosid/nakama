import type { ProviderName } from "./contract";

// xAI runs a single global platform (no CN split). The base URL is shared
// between the server provider factory and the web settings UI so both
// default to the same endpoint.

export const XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1";

export function defaultXaiBaseUrl(provider: ProviderName): string | null {
  if (provider === "xai") {
    return XAI_DEFAULT_BASE_URL;
  }

  return null;
}
