import { isValidBaseUrl } from "./compatible-provider-config";
import type { WebSearchProvider } from "./contract";
import { readTextOrNull } from "./fs";
import { maskTrailingSecret, REDACTED_SECRET_VALUE } from "./secret-mask";
import {
  getUserConfigPath,
  parseIniWithSections,
  writeParsedConfigIni,
} from "./user-config";

export const WEB_SEARCH_SECTION = "web_search";

/** Search back-ends that can replace the provider-hosted `web_search` tool. */
export const WEB_SEARCH_PROVIDERS: readonly WebSearchProvider[] = [
  "exa",
  "firecrawl",
];

export const WEB_SEARCH_PROVIDER_ENDPOINTS: Record<WebSearchProvider, string> =
  {
    exa: "https://api.exa.ai/search",
    firecrawl: "https://api.firecrawl.dev/v2/search",
  };

export const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProvider, string> = {
  exa: "Exa",
  firecrawl: "Firecrawl",
};

export interface WebSearchConfigFile {
  apiKey: string;
  endpoint: string;
  provider: WebSearchProvider;
}

export interface WebSearchSettingsPublic {
  apiKeyMasked: string | null;
  /** false means the active LLM provider's own hosted web search is used. */
  configured: boolean;
  endpoint: string | null;
  provider: WebSearchProvider | null;
}

export interface UpdateWebSearchSettingsInput {
  apiKey?: string;
  endpoint?: string;
  /** null clears the override and restores the built-in hosted search. */
  provider?: WebSearchProvider | null;
}

export function isWebSearchProvider(
  value: string | null | undefined
): value is WebSearchProvider {
  return WEB_SEARCH_PROVIDERS.includes(value as WebSearchProvider);
}

export function parseWebSearchProvider(
  value: string | null | undefined
): WebSearchProvider | null {
  const trimmed = value?.trim().toLowerCase();

  return isWebSearchProvider(trimmed) ? trimmed : null;
}

export function resolveWebSearchEndpoint(
  provider: WebSearchProvider,
  endpoint: string | undefined
): string {
  return endpoint?.trim() || WEB_SEARCH_PROVIDER_ENDPOINTS[provider];
}

export function isWebSearchConfigComplete(
  config: WebSearchConfigFile | null
): config is WebSearchConfigFile {
  if (!config) {
    return false;
  }

  if (!isValidBaseUrl(config.endpoint)) {
    return false;
  }

  return Boolean(config.apiKey.trim());
}

function parseWebSearchSection(
  values: Record<string, string>
): WebSearchConfigFile | null {
  const provider = parseWebSearchProvider(values.provider);

  if (!provider) {
    return null;
  }

  return {
    apiKey: values.api_key?.trim() ?? "",
    endpoint: resolveWebSearchEndpoint(provider, values.endpoint),
    provider,
  };
}

function buildWebSearchSectionValues(
  config: WebSearchConfigFile
): Record<string, string> {
  return {
    api_key: config.apiKey,
    endpoint: config.endpoint,
    provider: config.provider,
  };
}

export async function loadWebSearchConfig(): Promise<WebSearchConfigFile | null> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return null;
  }

  const section = parseIniWithSections(raw).sections[WEB_SEARCH_SECTION];

  return section ? parseWebSearchSection(section) : null;
}

export function toWebSearchSettingsPublic(
  file: WebSearchConfigFile | null
): WebSearchSettingsPublic {
  if (!file) {
    return {
      apiKeyMasked: null,
      configured: false,
      endpoint: null,
      provider: null,
    };
  }

  return {
    apiKeyMasked: maskTrailingSecret(file.apiKey),
    configured: isWebSearchConfigComplete(file),
    endpoint: file.endpoint || null,
    provider: file.provider,
  };
}

export async function loadWebSearchSettingsPublic(): Promise<WebSearchSettingsPublic> {
  return toWebSearchSettingsPublic(await loadWebSearchConfig());
}

export function resolveWebSearchApiKey(
  input: string | undefined,
  existing: WebSearchConfigFile | null
): string {
  if (input === undefined) {
    return existing?.apiKey ?? "";
  }

  const trimmed = input.trim();

  if (!trimmed || trimmed === REDACTED_SECRET_VALUE) {
    return existing?.apiKey ?? "";
  }

  return trimmed;
}

function buildSavedWebSearchConfig(
  input: UpdateWebSearchSettingsInput,
  existing: WebSearchConfigFile | null
): WebSearchConfigFile {
  const provider =
    input.provider === undefined
      ? (existing?.provider ?? null)
      : input.provider;

  if (!provider) {
    throw new Error("Select a web search provider.");
  }

  if (!isWebSearchProvider(provider)) {
    throw new Error(`Unsupported web search provider: ${provider}.`);
  }

  // Switching vendors must not inherit the previous vendor's endpoint.
  const carriedEndpoint =
    existing?.provider === provider ? existing.endpoint : undefined;
  const endpoint = resolveWebSearchEndpoint(
    provider,
    input.endpoint === undefined ? carriedEndpoint : input.endpoint
  );

  if (!isValidBaseUrl(endpoint)) {
    throw new Error("Endpoint must be a valid http or https URL.");
  }

  const apiKey = resolveWebSearchApiKey(
    input.apiKey,
    existing?.provider === provider ? existing : null
  );

  if (!apiKey) {
    throw new Error(
      `An API key is required for ${WEB_SEARCH_PROVIDER_LABELS[provider]}.`
    );
  }

  return {
    apiKey,
    endpoint: endpoint.trim(),
    provider,
  };
}

export async function saveWebSearchConfig(
  input: UpdateWebSearchSettingsInput
): Promise<WebSearchSettingsPublic> {
  const raw = await readTextOrNull(getUserConfigPath());
  const parsed =
    raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);

  if (input.provider === null) {
    delete parsed.sections[WEB_SEARCH_SECTION];
    await writeParsedConfigIni(parsed.global, parsed.sections);
    return toWebSearchSettingsPublic(null);
  }

  const next = buildSavedWebSearchConfig(input, await loadWebSearchConfig());

  parsed.sections[WEB_SEARCH_SECTION] = buildWebSearchSectionValues(next);
  await writeParsedConfigIni(parsed.global, parsed.sections);

  return toWebSearchSettingsPublic(next);
}
