/** Client-side opaque IDs that work outside secure contexts (e.g. http://LAN-IP). */
import { nanoid } from "nanoid";

export function createClientId(): string {
  return nanoid();
}

/** Grow/shrink a React-key list to match the current row count. */
export function syncRowKeys(rowKeys: string[], length: number): void {
  while (rowKeys.length < length) {
    rowKeys.push(createClientId());
  }
  rowKeys.length = length;
}
