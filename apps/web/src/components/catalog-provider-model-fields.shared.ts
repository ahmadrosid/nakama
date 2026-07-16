import type { SelectedProvider } from "@/lib/models";

export const CATALOG_SHORTLIST_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "opencode_go",
] as const;

export type CatalogShortlistProvider = (typeof CATALOG_SHORTLIST_PROVIDERS)[number];

export function isCatalogShortlistProvider(
  provider: SelectedProvider,
): provider is CatalogShortlistProvider {
  return (CATALOG_SHORTLIST_PROVIDERS as readonly string[]).includes(provider);
}
