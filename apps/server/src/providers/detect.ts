import {
  resolveProvider,
  type ProviderName,
  type UserProviderConfig,
} from "@tinyclaw/core";

export function detectProvider(
  env: Record<string, string | undefined> = process.env,
  userConfig?: UserProviderConfig | null,
): ProviderName | null {
  return resolveProvider({
    env,
    configuredProvider: userConfig?.provider,
  });
}
