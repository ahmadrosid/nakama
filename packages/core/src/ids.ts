export type ID = string;

export function createId(prefix: string): ID {
  return `${prefix}_${crypto.randomUUID()}`;
}
