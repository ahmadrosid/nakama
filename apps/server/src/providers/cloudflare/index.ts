import type { ProviderClient } from "@nakama/core";
import { createOpenAICompatibleProvider } from "../openai-compatible";

export interface CloudflareProviderOptions {
  accountId: string;
  apiKey: string;
  model: string;
}

/**
 * Cloudflare Workers AI provider.
 * Uses the OpenAI-compatible endpoint:
 *   https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1
 *
 * Auth: Authorization: Bearer {CLOUDFLARE_API_TOKEN}
 *
 * Docs: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
 */
export function createCloudflareProvider(
  options: CloudflareProviderOptions
): ProviderClient {
  const { accountId, apiKey, model } = options;
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;

  return createOpenAICompatibleProvider({
    apiKey,
    baseUrl,
    displayName: "Cloudflare Workers AI",
    model,
    providerName: "cloudflare",
    supportsThinking: false,
  });
}
