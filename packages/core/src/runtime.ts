import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeBaseUrl } from "./compatible-provider-config";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from "./fs";
import { getUserConfigDir, readUserWebPublicUrlSync } from "./user-config";

export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 4310;
export const DEFAULT_SERVER_URL = `http://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`;

function serverUrlPath(): string {
  return join(getUserConfigDir(), "runtime", "server-url.txt");
}

export function readRuntimeServerUrl(): string | null {
  try {
    const value = normalizeBaseUrl(readFileSync(serverUrlPath(), "utf8"));
    return value || null;
  } catch {
    return null;
  }
}

export function writeRuntimeServerUrl(url: string): string {
  const normalized = normalizeBaseUrl(url);
  mkdirSync(join(getUserConfigDir(), "runtime"), {
    recursive: true,
    mode: PRIVATE_DIR_MODE,
  });
  writeFileSync(serverUrlPath(), `${normalized}\n`, {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE,
  });
  return normalized;
}

export function clearRuntimeServerUrl(expectedUrl?: string): void {
  if (expectedUrl && readRuntimeServerUrl() !== normalizeBaseUrl(expectedUrl)) {
    return;
  }

  try {
    rmSync(serverUrlPath(), { force: true });
  } catch {
    // ignore cleanup errors
  }
}

export function resolveServerUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return normalizeBaseUrl(
    env.nakama_SERVER_URL?.trim() || readRuntimeServerUrl() || DEFAULT_SERVER_URL,
  );
}

/** Public web app origin for OAuth callbacks from non-browser clients (Telegram, WhatsApp, CLI). */
export function resolveWebPublicUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const configured = env.NAKAMA_WEB_PUBLIC_URL?.trim() || env.NAKAMA_PUBLIC_URL?.trim();
  if (configured) {
    return normalizeBaseUrl(configured);
  }

  return readUserWebPublicUrlSync() ?? undefined;
}
