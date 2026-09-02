import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_VERSION = "dev";

let packageVersion: string | null | undefined;

/**
 * Installed Nakama app version for operators (not the API contract number).
 * Prefer `NAKAMA_VERSION` (Docker/release), else root `package.json` `version`.
 */
export function getNakamaVersion(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.NAKAMA_VERSION?.trim();
  if (fromEnv) {
    return normalizeNakamaVersion(fromEnv);
  }

  return readPackageVersion() ?? FALLBACK_VERSION;
}

function normalizeNakamaVersion(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("v") || trimmed.startsWith("V")) {
    return trimmed.slice(1);
  }
  return trimmed;
}

function readPackageVersion(): string | null {
  if (packageVersion !== undefined) {
    return packageVersion;
  }

  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    const raw = readFileSync(join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    const version =
      typeof parsed.version === "string" ? parsed.version.trim() : "";
    packageVersion = version ? normalizeNakamaVersion(version) : null;
  } catch {
    packageVersion = null;
  }

  return packageVersion;
}
