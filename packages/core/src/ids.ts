export type ID = string;

const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Fixed-length URL-safe id (replaces nanoid for non-UUID cases). */
export function nanoid(size = 21): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";

  for (const byte of bytes) {
    id += ID_ALPHABET[byte % ID_ALPHABET.length];
  }

  return id;
}

export function createId(prefix: string): ID {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function generateTemporaryPassword(size = 12): string {
  return nanoid(size);
}
