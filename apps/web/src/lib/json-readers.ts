import type { JsonValue } from "@nakama/core/contract";

export type JsonRecord = { [key: string]: JsonValue };

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This reader accepts provider and tool JSON before the caller decodes it.
export function readRecord(value: unknown): JsonRecord | null {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Reject non-object JSON before treating the value as a record.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  // SAFETY: The check above admits only non-null, non-array objects.
  return value as JsonRecord;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This reader accepts provider and tool JSON before the caller decodes it.
export function readRawString(value: unknown): string | null {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Keep the exact string, including empty, whitespace and base64 payloads.
  return typeof value === "string" ? value : null;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This reader accepts provider and tool JSON before the caller decodes it.
export function readString(value: unknown): string | null {
  const text = readRawString(value);

  return text?.trim() || null;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This reader accepts provider and tool JSON before the caller decodes it.
export function readNumber(value: unknown): number | null {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Separate a numeric JSON field from the decoded value union.
  return typeof value === "number" ? value : null;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This reader accepts provider and tool JSON before the caller decodes it.
export function readBoolean(value: unknown): boolean | null {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Separate a boolean JSON field from the decoded value union.
  return typeof value === "boolean" ? value : null;
}
