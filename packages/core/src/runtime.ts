import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getUserConfigDir } from "./user-config";

export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 4310;
export const DEFAULT_SERVER_URL = `http://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`;

const runtimeDirName = "runtime";
const runtimeServerUrlFileName = "server-url.txt";

export function getRuntimeServerUrlPath(): string {
  return join(getUserConfigDir(), runtimeDirName, runtimeServerUrlFileName);
}

export function readRuntimeServerUrl(): string | null {
  try {
    const value = readFileSync(getRuntimeServerUrlPath(), "utf8").trim();
    return value ? normalizeServerUrl(value) : null;
  } catch {
    return null;
  }
}

export function writeRuntimeServerUrl(url: string): string {
  const normalizedUrl = normalizeServerUrl(url);
  const runtimeDir = join(getUserConfigDir(), runtimeDirName);

  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  writeFileSync(getRuntimeServerUrlPath(), `${normalizedUrl}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return normalizedUrl;
}

export function clearRuntimeServerUrl(expectedUrl?: string): void {
  if (expectedUrl) {
    const currentUrl = readRuntimeServerUrl();

    if (currentUrl !== normalizeServerUrl(expectedUrl)) {
      return;
    }
  }

  try {
    rmSync(getRuntimeServerUrlPath(), { force: true });
  } catch {
    // ignore cleanup errors
  }
}

export function resolveServerUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return normalizeServerUrl(
    env.TINYCLAW_SERVER_URL?.trim() ||
      readRuntimeServerUrl() ||
      DEFAULT_SERVER_URL,
  );
}

function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}
