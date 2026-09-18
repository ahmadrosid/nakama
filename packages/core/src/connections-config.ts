import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { join } from "node:path";
import { readTextIfExists, writeTextFile } from "./fs";
import { maskTrailingSecret } from "./secret-mask";
import { getUserConfigDir } from "./user-config";

export interface ConnectionSecret {
  createdAt: string;
  name: string;
  updatedAt: string;
  value: string;
}

export interface ConnectionPublic {
  createdAt: string;
  name: string;
  updatedAt: string;
  valueMasked: string;
}

function connectionsPath(): string {
  return join(getUserConfigDir(), "connections.enc");
}

export function toConnectionPublic(
  connection: ConnectionSecret
): ConnectionPublic {
  return {
    createdAt: connection.createdAt,
    name: connection.name,
    updatedAt: connection.updatedAt,
    valueMasked: maskTrailingSecret(connection.value),
  };
}

export async function loadConnections(): Promise<ConnectionSecret[]> {
  const encrypted = await readTextIfExists(connectionsPath());
  if (!encrypted) {
    return [];
  }

  return JSON.parse(decrypt(encrypted)) as ConnectionSecret[];
}

export async function saveConnection(
  name: string,
  value: string
): Promise<ConnectionPublic> {
  const trimmedName = name.trim();
  const trimmedValue = value.trim();
  if (!/^[a-z0-9_-]+$/i.test(trimmedName)) {
    throw new Error(
      "Connection name may only contain letters, numbers, _ or -."
    );
  }
  if (!trimmedValue) {
    throw new Error("Connection value is required.");
  }

  const connections = await loadConnections();
  const now = new Date().toISOString();
  const existing = connections.find(
    (connection) => connection.name === trimmedName
  );
  const next = {
    createdAt: existing?.createdAt ?? now,
    name: trimmedName,
    updatedAt: now,
    value: trimmedValue,
  };
  const updated = connections.filter(
    (connection) => connection.name !== trimmedName
  );
  updated.push(next);
  await writeTextFile(connectionsPath(), encrypt(JSON.stringify(updated)), {
    ensureDir: getUserConfigDir(),
  });
  return toConnectionPublic(next);
}

export async function resolveConnectionValues(
  names: string[]
): Promise<Record<string, string>> {
  const connections = await loadConnections();
  const byName = new Map(
    connections.map((connection) => [connection.name, connection.value])
  );
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing connections: ${missing.join(", ")}`);
  }
  return Object.fromEntries(names.map((name) => [name, byName.get(name)!]));
}

function encryptionKey(): Buffer {
  const configured = process.env.NAKAMA_CONNECTIONS_KEY?.trim();
  if (!configured) {
    throw new Error(
      "NAKAMA_CONNECTIONS_KEY is required for encrypted connections."
    );
  }
  return createHash("sha256").update(configured).digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url"
  );
}

function decrypt(value: string): string {
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    bytes.subarray(0, 12)
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
