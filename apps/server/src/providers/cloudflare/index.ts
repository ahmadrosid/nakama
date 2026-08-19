import {
  cloudflareBaseUrlFromAccountId,
  normalizeBaseUrl,
  type ProviderClient,
  type ProviderInstance,
} from "@nakama/core";
import { createOpenAICompatibleProvider } from "../openai-compatible";

export { CLOUDFLARE_API_ROOT } from "@nakama/core";

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
      "Cloudflare provider requires an account ID on the provider instance (saved as base_url), or CLOUDFLARE_ACCOUNT_ID as a fallback."
    );
  }

  return cloudflareBaseUrlFromAccountId(accountId);
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
    displayName: "Cloudflare Worker AI",
    model: options.model,
    providerName: "cloudflare",
    supportsThinking: false,
  });
}
