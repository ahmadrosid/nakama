import type { ChatListItem } from "@/lib/chat-history";
import type { WebFetchToolState, WebSearchSource } from "@/components/chat/web-search.shared";

function formatDisplayUrlFromHref(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

export const WEB_FETCH_TOOL_NAME = "web_fetch";

/** Exa MCP fetch tool: `{server}__web_fetch_exa`. */
export const MCP_EXA_WEB_FETCH_TOOL_PATTERN = /^[a-zA-Z0-9_-]+__web_fetch_exa(?:_\d+)?$/;

export function isWebFetchTool(tool: string | undefined): boolean {
  if (!tool) {
    return false;
  }

  if (tool === WEB_FETCH_TOOL_NAME) {
    return true;
  }

  return MCP_EXA_WEB_FETCH_TOOL_PATTERN.test(tool);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSourceUrl(url: string): { url: string; href: string } {
  const trimmed = url.trim();
  const href = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  return { url: trimmed, href };
}

function dedupeSources(sources: WebSearchSource[]): WebSearchSource[] {
  const seen = new Set<string>();
  const next: WebSearchSource[] = [];

  for (const source of sources) {
    const key = source.href ?? source.url;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    next.push(source);
  }

  return next;
}

function sourceFromUrl(url: string, title?: string | null): WebSearchSource {
  const normalized = normalizeSourceUrl(url);
  return {
    title: title?.trim() || formatDisplayUrlFromHref(normalized.url),
    url: normalized.url,
    href: normalized.href,
  };
}

export function parseWebFetchUrls(input: unknown): string[] {
  const record = readRecord(input);
  if (!record) {
    return [];
  }

  const directUrl = readString(record.url);
  if (directUrl) {
    return [directUrl];
  }

  const urls = record.urls;
  if (!Array.isArray(urls)) {
    return [];
  }

  const next: string[] = [];
  for (const entry of urls) {
    const url = readString(entry);
    if (url) {
      next.push(url);
    }
  }

  return next;
}

function parseMcpTextContent(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];

  for (const entry of content) {
    const record = readRecord(entry);
    if (record?.type === "text" && typeof record.text === "string" && record.text.trim()) {
      parts.push(record.text.trim());
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Parse Exa MCP `web_fetch_exa` markdown blocks (`# title` + `URL:` lines). */
export function parseExaWebFetchTextResult(text: string): WebSearchSource[] {
  const trimmed = text.trim();
  if (
    !trimmed ||
    /^no content found/i.test(trimmed) ||
    /^error fetching url/i.test(trimmed)
  ) {
    return [];
  }

  const blocks = trimmed.split(/\n(?=# )/);
  const sources: WebSearchSource[] = [];

  for (const block of blocks) {
    const titleMatch = block.match(/^#\s*(.+)$/m);
    const urlMatch = block.match(/^URL:\s*(.+)$/m);
    const url = urlMatch?.[1]?.trim();

    if (!url) {
      continue;
    }

    const rawTitle = titleMatch?.[1]?.trim();
    const title =
      rawTitle && rawTitle !== "(no title)" ? rawTitle : undefined;

    sources.push(sourceFromUrl(url, title));
  }

  return dedupeSources(sources);
}

function parseBuiltinWebFetchResult(record: Record<string, unknown>): WebSearchSource[] {
  const url = readString(record.finalUrl) ?? readString(record.url);
  if (!url) {
    return [];
  }

  return [sourceFromUrl(url)];
}

function parseStructuredFetchResults(results: unknown): WebSearchSource[] {
  if (!Array.isArray(results)) {
    return [];
  }

  const sources: WebSearchSource[] = [];

  for (const entry of results) {
    const record = readRecord(entry);
    if (!record) {
      continue;
    }

    const url = readString(record.url);
    if (!url) {
      continue;
    }

    sources.push(
      sourceFromUrl(
        url,
        readString(record.title),
      ),
    );
  }

  return dedupeSources(sources);
}

export function parseWebFetchSourcesFromResult(result: unknown): WebSearchSource[] {
  if (result == null) {
    return [];
  }

  const record = readRecord(result);
  if (!record) {
    if (typeof result === "string") {
      return parseExaWebFetchTextResult(result);
    }

    return [];
  }

  if (readString(record.error)) {
    return [];
  }

  const structured = parseStructuredFetchResults(record.results);
  if (structured.length > 0) {
    return structured;
  }

  const builtin = parseBuiltinWebFetchResult(record);
  if (builtin.length > 0 && !readString(record.error)) {
    return builtin;
  }

  const textResult =
    readString(record.text) ??
    parseMcpTextContent(record.content) ??
    null;

  if (textResult) {
    const exaSources = parseExaWebFetchTextResult(textResult);
    if (exaSources.length > 0) {
      return exaSources;
    }
  }

  return parseBuiltinWebFetchResult(record);
}

export function formatWebFetchHeaderText(urls: string[]): string {
  if (urls.length === 0) {
    return "page";
  }

  if (urls.length === 1) {
    return formatDisplayUrlFromHref(urls[0]!);
  }

  return `${urls.length} pages`;
}

export function buildWebFetchToolState(item: ChatListItem): WebFetchToolState {
  const status = item.toolStatus === "running" ? "running" : "done";
  const inputUrls = parseWebFetchUrls(item.toolInput);
  const resultSources =
    status === "done" ? parseWebFetchSourcesFromResult(item.toolResult) : [];

  const sources =
    status === "running"
      ? inputUrls.map((url) => sourceFromUrl(url))
      : resultSources.length > 0
        ? resultSources
        : inputUrls.map((url) => sourceFromUrl(url));

  return {
    headerText: formatWebFetchHeaderText(inputUrls),
    sources,
    status,
  };
}

export function shouldRenderWebFetchToolRow(message: ChatListItem): boolean {
  if (!isWebFetchTool(message.tool)) {
    return false;
  }

  const state = buildWebFetchToolState(message);
  if (state.status === "running") {
    return true;
  }

  return state.sources.length > 0;
}
