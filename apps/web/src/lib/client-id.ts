import { nanoid } from "@nakama/core/ids";

/** Client-side opaque IDs that work outside secure contexts (e.g. http://LAN-IP). */
export function createClientId(): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof crypto?.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // insecure context (non-localhost HTTP) — fall through
    }
  }

  return nanoid();
}

/** Grow/shrink a React-key list to match the current row count. */
export function syncRowKeys(rowKeys: string[], length: number): void {
  while (rowKeys.length < length) {
    rowKeys.push(createClientId());
  }

  rowKeys.length = length;
}
