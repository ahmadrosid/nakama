import type { ChatListItem } from "@/lib/chat-history";
import type { WebSearchSource, WebSearchToolState } from "@/components/chat/web-search.shared";

export const WEB_SEARCH_TOOL_NAME = "web_search";

/** Exa MCP tools are namespaced as `{server}__web_search_exa` (see packages/core/src/mcp/preinstalled.ts). */
export const MCP_EXA_WEB_SEARCH_TOOL_PATTERN =
  /^[a-zA-Z0-9_-]+__web_search(?:_advanced)?_exa(?:_\d+)?$/;

export function isWebSearchTool(tool: string | undefined): boolean {
  if (!tool) {
    return false;
  }

  if (tool === WEB_SEARCH_TOOL_NAME) {
    return true;
  }

  return MCP_EXA_WEB_SEARCH_TOOL_PATTERN.test(tool);
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

export function parseWebSearchQuery(input: unknown): string | null {
  const record = readRecord(input);

  if (!record) {
    return null;
  }

  const directQuery = readString(record.query);
  if (directQuery) {
    return directQuery;
  }

  const queries = record.queries;
  if (Array.isArray(queries)) {
    for (const entry of queries) {
      const query = readString(entry);
      if (query) {
        return query;
      }
    }
  }

  return null;
}

function normalizeSourceUrl(url: string): { url: string; href: string } {
  const trimmed = url.trim();
  const href = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  return { url: trimmed, href };
}

function sourceFromRecord(record: Record<string, unknown>): WebSearchSource | null {
  const url = readString(record.url) ?? readString(record.uri) ?? readString(record.link);
  if (!url) {
    return null;
  }

  const normalized = normalizeSourceUrl(url);
  const title =
    readString(record.title) ??
    readString(record.name) ??
    readString(record.page_title) ??
    normalized.url;

  return {
    title,
    url: normalized.url,
    href: normalized.href,
  };
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

function parseSourcesFromContentArray(content: unknown): WebSearchSource[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const sources: WebSearchSource[] = [];

  for (const entry of content) {
    const record = readRecord(entry);
    if (!record) {
      continue;
    }

    const type = readString(record.type);

    if (type === "web_search_result" || type === "url" || type === "url_citation" || !type) {
      const source = sourceFromRecord(record);
      if (source) {
        sources.push(source);
      }
    }
  }

  return dedupeSources(sources);
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

/** Parse Exa MCP `web_search_exa` formatted text blocks (Title/URL fields separated by ---). */
export function parseExaWebSearchTextResult(text: string): WebSearchSource[] {
  const trimmed = text.trim();
  if (!trimmed || /^no search results found/i.test(trimmed)) {
    return [];
  }

  const blocks = trimmed.split(/\n---\n/);
  const sources: WebSearchSource[] = [];

  for (const block of blocks) {
    const titleMatch = block.match(/^Title:\s*(.+)$/m);
    const urlMatch = block.match(/^URL:\s*(.+)$/m);
    const url = urlMatch?.[1]?.trim();

    if (!url || !titleMatch) {
      continue;
    }

    const normalized = normalizeSourceUrl(url);
    const title = titleMatch[1]?.trim() || normalized.url;

    sources.push({
      title,
      url: normalized.url,
      href: normalized.href,
    });
  }

  return dedupeSources(sources);
}

function parseExaStructuredResults(results: unknown): WebSearchSource[] {
  if (!Array.isArray(results)) {
    return [];
  }

  const sources: WebSearchSource[] = [];

  for (const entry of results) {
    const record = readRecord(entry);
    if (!record) {
      continue;
    }

    const source = sourceFromRecord(record);
    if (source) {
      sources.push(source);
    }
  }

  return dedupeSources(sources);
}

export function parseWebSearchSourcesFromResult(result: unknown): WebSearchSource[] {
  if (result == null) {
    return [];
  }

  if (Array.isArray(result)) {
    return parseSourcesFromContentArray(result);
  }

  const record = readRecord(result);
  if (!record) {
    if (typeof result === "string") {
      return parseExaWebSearchTextResult(result);
    }

    return [];
  }

  const exaResults = parseExaStructuredResults(record.results);
  if (exaResults.length > 0) {
    return exaResults;
  }

  const textResult =
    readString(record.text) ??
    parseMcpTextContent(record.content) ??
    null;

  if (textResult) {
    const exaSources = parseExaWebSearchTextResult(textResult);
    if (exaSources.length > 0) {
      return exaSources;
    }
  }

  const directSources = parseSourcesFromContentArray(record.sources);
  if (directSources.length > 0) {
    return directSources;
  }

  const resultsSources = parseSourcesFromContentArray(record.results);
  if (resultsSources.length > 0) {
    return resultsSources;
  }

  const contentSources = parseSourcesFromContentArray(record.content);
  if (contentSources.length > 0) {
    return contentSources;
  }

  const action = readRecord(record.action);
  if (action) {
    const actionSources = parseWebSearchSourcesFromResult(action);
    if (actionSources.length > 0) {
      return actionSources;
    }
  }

  const single = sourceFromRecord(record);
  return single ? [single] : [];
}

export interface ExtractedWebSearchBlock {
  toolCallId: string;
  query?: string | null;
  result?: unknown;
}

export function extractWebSearchBlocksFromProviderContent(
  providerContent: unknown,
): ExtractedWebSearchBlock[] {
  if (!Array.isArray(providerContent)) {
    return [];
  }

  const pending = new Map<string, ExtractedWebSearchBlock>();
  const ordered: ExtractedWebSearchBlock[] = [];

  for (const block of providerContent) {
    const record = readRecord(block);
    if (!record) {
      continue;
    }

    const type = readString(record.type);

    if (type === "server_tool_use") {
      const toolCallId = readString(record.id);
      const name = readString(record.name);

      if (!toolCallId || name !== WEB_SEARCH_TOOL_NAME) {
        continue;
      }

      const entry: ExtractedWebSearchBlock = {
        toolCallId,
        query: parseWebSearchQuery(record.input),
      };
      pending.set(toolCallId, entry);
      ordered.push(entry);
      continue;
    }

    if (type === "web_search_tool_result") {
      const toolCallId = readString(record.tool_use_id);
      if (!toolCallId) {
        continue;
      }

      const existing = pending.get(toolCallId) ?? { toolCallId };
      existing.result = record.content ?? record;
      pending.set(toolCallId, existing);

      if (!ordered.some((entry) => entry.toolCallId === toolCallId)) {
        ordered.push(existing);
      }
      continue;
    }

    if (type === "web_search_call") {
      const toolCallId = readString(record.id);
      if (!toolCallId) {
        continue;
      }

      const action = readRecord(record.action);
      ordered.push({
        toolCallId,
        query: parseWebSearchQuery(action),
        result: action ?? record,
      });
    }
  }

  return ordered;
}

export function buildWebSearchToolState(item: ChatListItem): WebSearchToolState {
  const status = item.toolStatus === "running" ? "running" : "done";
  const query =
    parseWebSearchQuery(item.toolInput) ??
    parseWebSearchQuery(readRecord(item.toolResult)?.action) ??
    null;
  const sources =
    status === "done" ? parseWebSearchSourcesFromResult(item.toolResult) : [];

  return {
    query,
    sources,
    status,
  };
}

export function shouldRenderWebSearchToolRow(message: ChatListItem): boolean {
  if (!isWebSearchTool(message.tool)) {
    return false;
  }

  const state = buildWebSearchToolState(message);
  if (state.status === "running") {
    return true;
  }

  return state.sources.length > 0;
}
