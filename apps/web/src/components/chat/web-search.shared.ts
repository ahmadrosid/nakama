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

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonRecord;

export type JsonRecord = { [key: string]: JsonValue };

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts provider JSON at the boundary.
export function readRecord(value: unknown): JsonRecord | null {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Check the provider JSON shape before using it.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  // SAFETY: Tool results and provider responses contain JSON objects.
  return value as JsonRecord;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts provider JSON at the boundary.
export function readString(value: unknown): string | null {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Check the provider JSON value before using it.
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeSourceUrl(url: string) {
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
