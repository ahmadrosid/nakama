import type { McpTransport } from "@nakama/core/contract";

export const sectionClass = "rounded-md border border-border bg-card";
const REDACTED_SECRET_VALUE = "••••••••";

export type McpHeaderRow = {
  key: string;
  value: string;
};

export function emptyHeaderRow(): McpHeaderRow {
  return { key: "", value: "" };
}

export function recordToHeaderRows(headers?: Record<string, string>): McpHeaderRow[] {
  if (!headers || Object.keys(headers).length === 0) {
    return [emptyHeaderRow()];
  }

  return Object.entries(headers).map(([key, value]) => ({
    key,
    value: value === REDACTED_SECRET_VALUE ? "" : value,
  }));
}

export function resolveFormTransport(
  transport: McpTransport,
  command: string,
  url: string,
): McpTransport {
  if (command.trim()) {
    return "stdio";
  }

  if (url.trim()) {
    return "http";
  }

  return transport;
}

export function argsToArray(values: string[]): string[] | undefined {
  const items = values.flatMap((value) => {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  });
  return items.length > 0 ? items : undefined;
}

export function headersToRecord(
  rows: McpHeaderRow[],
  forUpdate = false,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};

  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();

    if (!key) {
      continue;
    }

    if (forUpdate) {
      headers[key] = value;
      continue;
    }

    if (value) {
      headers[key] = value;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}
