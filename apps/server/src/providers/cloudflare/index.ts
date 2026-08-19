import {
  normalizeBaseUrl,
  type ProviderClient,
  type ProviderInstance,
} from "@nakama/core";
import { createOpenAICompatibleProvider } from "../openai-compatible";

export const CLOUDFLARE_API_ROOT =
  "https://api.cloudflare.com/client/v4/accounts";

export function resolveCloudflareBaseUrl(
  accountId: string,
  instance?: ProviderInstance | null
): string {
  const trimmed = instance?.baseUrl?.trim();
  if (trimmed) {
    return normalizeBaseUrl(trimmed);
  }

  if (!accountId) {
    throw new Error(
      "Cloudflare provider requires CLOUDFLARE_ACCOUNT_ID env var, or paste the full Workers AI endpoint (https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1) into the provider base URL."
    );
  }

  return `${CLOUDFLARE_API_ROOT}/${accountId}/ai/v1`;
}

export function createCloudflareProvider(options: {
  accountId: string;
  apiKey: string;
  instance?: ProviderInstance | null;
  model: string;
}): ProviderClient {
  if (!options.apiKey.trim()) {
    throw new Error("Cloudflare provider requires an API key.");
  }

  return createOpenAICompatibleProvider({
    apiKey: options.apiKey,
    baseUrl: resolveCloudflareBaseUrl(options.accountId, options.instance),
    displayName: "Cloudflare",
    model: options.model,
    providerName: "cloudflare",
    supportsThinking: false,
  });
}
