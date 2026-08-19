import type { ProviderClient } from "@nakama/core";
import { createOpenAICompatibleProvider } from "../openai-compatible";

export interface CloudflareProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Cloudflare Workers AI provider.
 * Uses the OpenAI-compatible endpoint:
 *   https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1
 *
 * The baseUrl can be:
 *   - Full URL: https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1
 *   - Account ID only: {accountId} (will be expanded to full URL)
 *
 * Auth: Authorization: Bearer {CLOUDFLARE_API_TOKEN}
 *
 * Docs: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
 */
export function createCloudflareProvider(
  options: CloudflareProviderOptions
): ProviderClient {
  const { baseUrl, apiKey, model } = options;

  // Accept either full URL or just account ID
  const fullUrl = baseUrl.includes("api.cloudflare.com")
    ? baseUrl
    : `https://api.cloudflare.com/client/v4/accounts/${baseUrl}/ai/v1`;

  return createOpenAICompatibleProvider({
    apiKey,
    baseUrl: fullUrl,
    displayName: "Cloudflare Workers AI",
    model,
    providerName: "cloudflare",
    supportsThinking: false,
  });
}
