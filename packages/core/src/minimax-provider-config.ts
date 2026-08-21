import type { ProviderName } from "./contract";

// MiniMax runs split platforms with separate keys and catalogs. Base URLs are
// shared between the server provider factory and the web settings UI so both
// default to the same region endpoints.

export const MINIMAX_DEFAULT_BASE_URL = "https://api.minimax.io/v1";
export const MINIMAX_CN_DEFAULT_BASE_URL = "https://api.minimaxi.com/v1";

export function defaultMinimaxBaseUrl(provider: ProviderName): string | null {
  if (provider === "minimax") {
    return MINIMAX_DEFAULT_BASE_URL;
  }

  if (provider === "minimax_cn") {
    return MINIMAX_CN_DEFAULT_BASE_URL;
  }

  return null;
}
