import type { ListTimezonesResponse, TimezoneCatalogEntry } from "@nakama/core/contract";

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function getTimezoneEntries(
  response: ListTimezonesResponse | undefined,
): TimezoneCatalogEntry[] {
  if (!response) {
    return [];
  }

  return response.groups.flatMap((group) => group.timezones);
}

export function findTimezoneEntry(
  id: string | undefined,
  response: ListTimezonesResponse | undefined,
): TimezoneCatalogEntry | null {
  const trimmed = id?.trim();

  if (!trimmed || !response) {
    return null;
  }

  for (const group of response.groups) {
    const match = group.timezones.find((entry) => entry.id === trimmed);

    if (match) {
      return match;
    }
  }

  return null;
}

export function searchTimezoneEntries(
  query: string,
  response: ListTimezonesResponse | undefined,
): TimezoneCatalogEntry[] {
  const entries = getTimezoneEntries(response);
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return entries;
  }

  return entries.filter((entry) => {
    const haystack = [
      entry.id,
      entry.city,
      entry.countryCode,
      entry.countryName,
      entry.offset,
      entry.abbreviation,
      entry.tzName,
      entry.label,
      ...(entry.aliases ?? []),
    ]
      .join(" ")
      .toLowerCase()
      .replace(/_/g, " ");

    return tokens.every((token) => haystack.includes(token));
  });
}

export function getTimezoneDisplay(
  value: string | undefined,
  emptyLabel = "Select timezone",
  response?: ListTimezonesResponse,
): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return emptyLabel;
  }

  return findTimezoneEntry(trimmed, response)?.label ?? trimmed;
}

export function getFilteredTimezoneGroups(
  query: string,
  response: ListTimezonesResponse | undefined,
): ListTimezonesResponse["groups"] {
  if (!response) {
    return [];
  }

  if (!query.trim()) {
    return response.groups;
  }

  const matches = new Set(searchTimezoneEntries(query, response).map((entry) => entry.id));

  const groups: typeof response.groups = [];

  for (const group of response.groups) {
    const timezones = group.timezones.filter((entry) => matches.has(entry.id));
    if (timezones.length > 0) {
      groups.push({ ...group, timezones });
    }
  }

  return groups;
}
