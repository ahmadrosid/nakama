import type {
  ToolContext,
  ToolDefinition,
  WebSearchProvider,
} from "../contract";
import { withDisabledFetchIdle } from "../fetch-idle";
import {
  isWebSearchConfigComplete,
  WEB_SEARCH_PROVIDER_LABELS,
  type WebSearchConfigFile,
} from "../web-search-config";
import { jsonSchemaFromZod } from "./schema";
import {
  WEB_SEARCH_TOOL_NAME,
  type WebSearchInput,
  webSearchInputSchema,
} from "./web-search";

const REQUEST_TIMEOUT_MS = 30_000;
/** Snippets are context, not documents; web_fetch is the escape hatch for full text. */
const MAX_SNIPPET_CHARS = 800;
const MAX_ERROR_BODY_CHARS = 300;

export interface CustomWebSearchResult {
  publishedDate?: string;
  snippet?: string;
  title: string;
  url: string;
}

export interface CustomWebSearchOutput {
  provider: WebSearchProvider;
  query: string;
  /** Shape mirrors Exa's `results`, which the web chat UI already renders. */
  results: CustomWebSearchResult[];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

function buildRequest(
  config: WebSearchConfigFile,
  query: string
): { body: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (config.provider === "exa") {
    headers["x-api-key"] = config.apiKey;
    return {
      body: JSON.stringify({
        contents: { text: { maxCharacters: MAX_SNIPPET_CHARS } },
        numResults: config.maxResults,
        query,
      }),
      headers,
    };
  }

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  return {
    body: JSON.stringify({ limit: config.maxResults, query }),
    headers,
  };
}

/**
 * Search APIs disagree on where the hit list lives: Exa uses `results`,
 * Firecrawl `data.web`, and self-hosted engines commonly `organic` or `items`.
 */
function findResultArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = readRecord(payload);

  if (!record) {
    return [];
  }

  for (const key of ["results", "web", "organic", "organic_results", "items"]) {
    const candidate = record[key];

    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  const data = record.data;

  return data === undefined ? [] : findResultArray(data);
}

function toResult(entry: unknown): CustomWebSearchResult | null {
  const record = readRecord(entry);

  if (!record) {
    return null;
  }

  const url =
    readString(record.url) ?? readString(record.link) ?? readString(record.uri);

  if (!url) {
    return null;
  }

  const snippet =
    readString(record.snippet) ??
    readString(record.description) ??
    readString(record.text) ??
    readString(record.markdown) ??
    readString(record.content);

  return {
    title: readString(record.title) ?? readString(record.name) ?? url,
    url,
    ...(snippet ? { snippet: truncate(snippet, MAX_SNIPPET_CHARS) } : {}),
    ...(readString(record.publishedDate)
      ? { publishedDate: readString(record.publishedDate) }
      : {}),
  };
}

export function parseCustomWebSearchResults(
  payload: unknown,
  maxResults: number
): CustomWebSearchResult[] {
  const results: CustomWebSearchResult[] = [];
  const seen = new Set<string>();

  for (const entry of findResultArray(payload)) {
    const result = toResult(entry);

    if (!result || seen.has(result.url)) {
      continue;
    }

    seen.add(result.url);
    results.push(result);

    if (results.length >= maxResults) {
      break;
    }
  }

  return results;
}

function resolveSignal(context: ToolContext | undefined): AbortSignal {
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  return context?.signal
    ? AbortSignal.any([context.signal, deadline])
    : deadline;
}

export async function runCustomWebSearch(
  config: WebSearchConfigFile,
  input: WebSearchInput,
  context?: ToolContext
): Promise<CustomWebSearchOutput> {
  const { query } = webSearchInputSchema.parse(input);
  const { body, headers } = buildRequest(config, query);
  const response = await fetch(
    config.endpoint,
    withDisabledFetchIdle({
      body,
      headers,
      method: "POST",
      signal: resolveSignal(context),
    })
  );

  if (!response.ok) {
    const detail = truncate(
      (await response.text().catch(() => "")).trim(),
      MAX_ERROR_BODY_CHARS
    );

    throw new Error(
      `web_search: ${WEB_SEARCH_PROVIDER_LABELS[config.provider]} returned ${response.status}${detail ? ` — ${detail}` : ""}.`
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error("web_search: search endpoint returned invalid JSON.");
  }

  return {
    provider: config.provider,
    query,
    results: parseCustomWebSearchResults(payload, config.maxResults),
  };
}

/**
 * Replaces the hosted `web_search` stub when a search back-end is configured.
 * `hosted: false` is what keeps `partitionTools` executing it locally instead
 * of asking the LLM provider to run its own search.
 */
export function createCustomWebSearchTool(
  config: WebSearchConfigFile | null
): ToolDefinition<WebSearchInput, CustomWebSearchOutput> | null {
  if (!isWebSearchConfigComplete(config)) {
    return null;
  }

  return {
    description: `Search the web for current information via ${WEB_SEARCH_PROVIDER_LABELS[config.provider]}. Returns titles, URLs and snippets; use web_fetch to read a result in full.`,
    hosted: false,
    name: WEB_SEARCH_TOOL_NAME,
    parallelSafe: true,
    parameters: jsonSchemaFromZod(webSearchInputSchema),
    run: (input, context) => runCustomWebSearch(config, input, context),
  };
}
