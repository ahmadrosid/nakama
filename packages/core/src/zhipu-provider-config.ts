import type { ProviderName } from "./contract";

// Zhipu runs split platforms under two brands — Z.ai (international) and
// Zhipu BigModel (China) — with separate keys and catalogs. Base URLs are
// shared between the server provider factory and the web settings UI so both
// default to the same region endpoints.

export const ZHIPU_DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4";
export const ZHIPU_CN_DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

export function defaultZhipuBaseUrl(provider: ProviderName): string | null {
  if (provider === "zhipu") {
    return ZHIPU_DEFAULT_BASE_URL;
  }

  if (provider === "zhipu_cn") {
    return ZHIPU_CN_DEFAULT_BASE_URL;
  }

  return null;
}
