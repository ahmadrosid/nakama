export type WebSearchSiteState = "pending" | "loading" | "done";

export type WebSourceCardMode = "search" | "fetch";

export interface WebSearchSource {
  href?: string;
  title: string;
  url: string;
}

export interface WebSearchToolState {
  query: string | null;
  sources: WebSearchSource[];
  status: "running" | "done";
}

export interface WebFetchToolState {
  headerText: string | null;
  sources: WebSearchSource[];
  status: "running" | "done";
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeSourceUrl(url: string): { url: string; href: string } {
  const trimmed = url.trim();
  const href = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  return { href, url: trimmed };
}

export function dedupeSources(sources: WebSearchSource[]): WebSearchSource[] {
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
