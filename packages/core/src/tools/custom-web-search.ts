import { z } from "zod";
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

/** Fixed until a settings control needs to vary it; five hits is Exa's own default. */
const MAX_RESULTS = 5;

/** Snippets are context, not documents; web_fetch is the escape hatch for full text. */
const MAX_SNIPPET_CHARS = 800;

const MAX_ERROR_BODY_CHARS = 300;

const JsonObjectSchema = z.record(z.string(), z.json());

const JsonValueSchema = z.json();

type JsonObject = z.infer<typeof JsonObjectSchema>;

type JsonValue = z.infer<typeof JsonValueSchema>;

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

function readRecord(value: JsonValue): JsonObject | null {
  const parsed = JsonObjectSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function readString(value: JsonValue | undefined): string | undefined {
  const parsed = z.string().safeParse(value);

  return parsed.success && parsed.data.trim() ? parsed.data.trim() : undefined;
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

interface SearchRequestHeaders {
  accept: string;
  authorization?: string;
  "content-type": string;
  "x-api-key"?: string;
}

interface SearchRequest {
  body: string;
  headers: SearchRequestHeaders;
}

function buildRequest(
  config: WebSearchConfigFile,
  query: string
): SearchRequest {
  const headers: SearchRequestHeaders = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (config.provider === "exa") {
    headers["x-api-key"] = config.apiKey;

    return {
      body: JSON.stringify({
        contents: { text: { maxCharacters: MAX_SNIPPET_CHARS } },
        numResults: MAX_RESULTS,
        query,
      }),
      headers,
    };
  }

  headers.authorization = `Bearer ${config.apiKey}`;

  return {
    body: JSON.stringify({ limit: MAX_RESULTS, query }),
    headers,
  };
}

/** Exa puts hits on `results`; Firecrawl on `data.web`. */
function findResultArray(payload: JsonValue): JsonValue[] {
  const record = readRecord(payload);

  if (!record) {
    return [];
  }

  for (const key of ["results", "web"]) {
    const candidate = record[key];

    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  const data = record.data;

  return data === undefined ? [] : findResultArray(data);
}

function toResult(entry: JsonValue): CustomWebSearchResult | null {
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

  const result: CustomWebSearchResult = {
    title: readString(record.title) ?? readString(record.name) ?? url,
    url,
  };

  if (snippet) {
    result.snippet = truncate(snippet, MAX_SNIPPET_CHARS);
  }

  const publishedDate = readString(record.publishedDate);

  if (publishedDate) {
    result.publishedDate = publishedDate;
  }

  return result;
}

export function parseCustomWebSearchResults(
  payload: JsonValue
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

    if (results.length >= MAX_RESULTS) {
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

  let payload: JsonValue;

  try {
    payload = JsonValueSchema.parse(await response.json());
  } catch {
    throw new Error("web_search: search endpoint returned invalid JSON.");
  }

  return {
    provider: config.provider,
    query,
    results: parseCustomWebSearchResults(payload),
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
