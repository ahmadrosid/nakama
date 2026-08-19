import { isValidBaseUrl, normalizeBaseUrl } from "./compatible-provider-config";

export const CLOUDFLARE_API_ROOT =
  "https://api.cloudflare.com/client/v4/accounts";

const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function cloudflareBaseUrlFromAccountId(accountId: string): string {
  return `${CLOUDFLARE_API_ROOT}/${accountId}/ai/v1`;
}

export function resolveCloudflareAccountInput(input: string): string | null {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    if (!isValidBaseUrl(trimmed)) {
      return null;
    }

    return normalizeBaseUrl(trimmed);
  }

  if (!ACCOUNT_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return cloudflareBaseUrlFromAccountId(trimmed);
}
