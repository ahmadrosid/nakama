import { createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { readTextOrNull, writePrivateTextFile } from "./fs";
import { getUserConfigDir, loadUserConfig, saveUserConfig } from "./user-config";

const LOCAL_CLIENT_EMAIL = "local-client@tinyclaw.internal";
const LOCAL_AUTH_TOKEN_PREFIX = "tc_local_";
const LOCAL_AUTH_TOKEN_FILENAME = "local-auth-token";

function generateLocalAuthToken(): string {
  return `${LOCAL_AUTH_TOKEN_PREFIX}${nanoid(48)}`;
}

function hashLocalAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getLocalAuthTokenPath(): string {
  return join(getUserConfigDir(), LOCAL_AUTH_TOKEN_FILENAME);
}

async function loadStoredLocalAuthToken(): Promise<string | null> {
  const token = await readTextOrNull(getLocalAuthTokenPath());
  return token?.trim() || null;
}

async function persistLocalAuthToken(token: string): Promise<void> {
  await writePrivateTextFile(getLocalAuthTokenPath(), `${token}\n`, {
    ensureDir: getUserConfigDir(),
  });
}

function compareTokenHash(token: string, expectedHashHex: string): boolean {
  const actualHash = createHash("sha256").update(token).digest();
  const expectedHash = Buffer.from(expectedHashHex, "hex");

  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
}

export async function resolveLocalAuthToken(): Promise<string> {
  const envToken = process.env.TINYCLAW_LOCAL_AUTH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  const config = await loadUserConfig();
  const storedToken = await loadStoredLocalAuthToken();

  if (config?.localAuthTokenHash?.trim() && storedToken) {
    if (compareTokenHash(storedToken, config.localAuthTokenHash.trim())) {
      return storedToken;
    }
  }

  const legacyToken = config?.localAuthToken?.trim();
  if (legacyToken) {
    await persistLocalAuthToken(legacyToken);
    await saveUserConfig({ ...config, localAuthTokenHash: hashLocalAuthToken(legacyToken) });
    return legacyToken;
  }

  const generated = generateLocalAuthToken();
  const newConfig = config ?? {
    defaultProviderId: null,
    providers: [],
  };
  await persistLocalAuthToken(generated);
  await saveUserConfig({ ...newConfig, localAuthTokenHash: hashLocalAuthToken(generated) });
  return generated;
}

export async function loadLocalAuthToken(
  _email = LOCAL_CLIENT_EMAIL,
): Promise<string | null> {
  return resolveLocalAuthToken();
}

export async function verifyLocalAuthToken(
  token: string,
): Promise<{ email: string } | null> {
  if (!token) {
    return null;
  }

  const envToken = process.env.TINYCLAW_LOCAL_AUTH_TOKEN?.trim();
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
