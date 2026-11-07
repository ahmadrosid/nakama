export type ID = string;

const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Fixed-length URL-safe id (replaces nanoid for non-UUID cases). */
export function nanoid(size = 21): string {
  let id = "";

  // Mask to 0-63 and drop 62 and 63, so each of the 62 letters is equally likely.
  while (id.length < size) {
    for (const byte of crypto.getRandomValues(new Uint8Array(size))) {
      // biome-ignore lint/suspicious/noBitwiseOperators: a mask keeps the pick unbiased.
      const index = byte & 63;

      if (index < ID_ALPHABET.length && id.length < size) {
        id += ID_ALPHABET[index];
      }
    }
  }

  return id;
}

export function createId(prefix: string): ID {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function generateTemporaryPassword(size = 12): string {
  return nanoid(size);
}
