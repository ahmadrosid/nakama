import type { ProviderName, UserProviderConfig } from "@tinyclaw/core";
import { inferProviderFromApiKey } from "@tinyclaw/core";
import { getModelById } from "./models";

export function detectProvider(
  env: Record<string, string | undefined> = process.env,
  userConfig?: UserProviderConfig | null,
): ProviderName | null {
  if (env.OPENAI_API_KEY?.trim()) {
    return "openai";
  }

  if (env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic";
  }

  const apiKey = userConfig?.apiKey?.trim();

  if (!apiKey) {
    return null;
  }

  if (userConfig.model) {
    const option = getModelById(userConfig.model);

    if (option) {
      return option.provider;
    }
  }

  if (userConfig.provider) {
    return userConfig.provider;
  }

  return inferProviderFromApiKey(apiKey);
}
