/** Client-side opaque IDs that work outside secure contexts (e.g. http://LAN-IP). */
const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const ID_LENGTH = 21;

export function createClientId(): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof crypto?.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // insecure context (non-localhost HTTP) — fall through
    }
  }

  let id = "";

  // Mask to 0-63 and drop 62 and 63, so each of the 62 letters is equally likely.
  while (id.length < ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(ID_LENGTH))) {
      // biome-ignore lint/suspicious/noBitwiseOperators: a mask keeps the pick unbiased.
      const index = byte & 63;

      if (index < ID_ALPHABET.length && id.length < ID_LENGTH) {
        id += ID_ALPHABET[index];
      }
    }
  }

  return id;
}

/** Grow/shrink a React-key list to match the current row count. */
export function syncRowKeys(rowKeys: string[], length: number): void {
  while (rowKeys.length < length) {
    rowKeys.push(createClientId());
  }

  rowKeys.length = length;
}
