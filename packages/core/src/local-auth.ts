import { createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { readTextOrNull, writeTextFile } from "./fs";
import { nanoid } from "./ids";
import {
  getUserConfigDir,
  getUserConfigPath,
  loadUserConfig,
  parseIniWithSections,
  writeParsedConfigIni,
} from "./user-config";

export const LOCAL_CLIENT_EMAIL = "local-client@nakama.internal";
export const LOCAL_CLIENT_USER_ID = "user_local_client";
const LOCAL_AUTH_TOKEN_PREFIX = "tc_local_";
const LOCAL_AUTH_TOKEN_FILENAME = "local-auth-token";

export class LocalAuthTokenManagedExternallyError extends Error {
  constructor() {
    super(
      "Local auth token is managed by NAKAMA_LOCAL_AUTH_TOKEN and cannot be rotated on disk."
    );
    this.name = "LocalAuthTokenManagedExternallyError";
  }
}

function generateLocalAuthToken(): string {
  return `${LOCAL_AUTH_TOKEN_PREFIX}${nanoid(48)}`;
}

function hashLocalAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getLocalAuthTokenPath(): string {
  return join(getUserConfigDir(), LOCAL_AUTH_TOKEN_FILENAME);
}

async function persistLocalAuthTokenHash(token: string): Promise<void> {
  const raw = await readTextOrNull(getUserConfigPath());
  const parsed =
    raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);

  await writeParsedConfigIni(parsed.global, parsed.sections, {
    local_auth_token_hash: hashLocalAuthToken(token),
  });
}

async function loadStoredLocalAuthToken(): Promise<string | null> {
  const token = await readTextOrNull(getLocalAuthTokenPath());
  return token?.trim() || null;
}

async function persistLocalAuthToken(token: string): Promise<void> {
  await writeTextFile(getLocalAuthTokenPath(), `${token}\n`, {
    ensureDir: getUserConfigDir(),
  });
}

function compareTokenHash(token: string, expectedHashHex: string): boolean {
  const actualHash = createHash("sha256").update(token).digest();
  const expectedHash = Buffer.from(expectedHashHex, "hex");

  return (
    actualHash.length === expectedHash.length &&
    timingSafeEqual(actualHash, expectedHash)
  );
}

export async function resolveLocalAuthToken(): Promise<string> {
  const envToken = process.env.NAKAMA_LOCAL_AUTH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  const config = await loadUserConfig();
  const storedToken = await loadStoredLocalAuthToken();

  if (
    config?.localAuthTokenHash?.trim() &&
    storedToken &&
    compareTokenHash(storedToken, config.localAuthTokenHash.trim())
  ) {
    return storedToken;
  }

  const legacyToken = config?.localAuthToken?.trim();
  if (legacyToken) {
    await persistLocalAuthToken(legacyToken);
    await persistLocalAuthTokenHash(legacyToken);
    return legacyToken;
  }

  const generated = generateLocalAuthToken();
  await persistLocalAuthToken(generated);
  await persistLocalAuthTokenHash(generated);
  return generated;
}

export async function loadLocalAuthToken(
  _email = LOCAL_CLIENT_EMAIL
): Promise<string | null> {
  return resolveLocalAuthToken();
}

export async function rotateLocalAuthToken(): Promise<string> {
  if (process.env.NAKAMA_LOCAL_AUTH_TOKEN?.trim()) {
    throw new LocalAuthTokenManagedExternallyError();
  }

  const token = generateLocalAuthToken();

  await persistLocalAuthToken(token);
  await persistLocalAuthTokenHash(token);

  return token;
}

export async function verifyLocalAuthToken(
  token: string
): Promise<{ email: string } | null> {
  if (!token) {
    return null;
  }

  const envToken = process.env.NAKAMA_LOCAL_AUTH_TOKEN?.trim();
  if (envToken) {
    return compareTokenHash(token, hashLocalAuthToken(envToken))
      ? { email: LOCAL_CLIENT_EMAIL }
      : null;
  }

  const config = await loadUserConfig();
  const expectedHash = config?.localAuthTokenHash?.trim();
  if (expectedHash) {
    return compareTokenHash(token, expectedHash)
      ? { email: LOCAL_CLIENT_EMAIL }
      : null;
  }

  const legacyToken = config?.localAuthToken?.trim();
  if (legacyToken && compareTokenHash(token, hashLocalAuthToken(legacyToken))) {
    return { email: LOCAL_CLIENT_EMAIL };
  }

  return null;
}
