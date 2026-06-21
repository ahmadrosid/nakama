import { nanoid } from "nanoid";

export type ID = string;

export function createId(prefix: string): ID {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createProfileId(): ID {
  return crypto.randomUUID();
}

export function createSessionId(): ID {
  return nanoid();
}

export function generateTemporaryPassword(size = 12): string {
  return nanoid(size);
}
