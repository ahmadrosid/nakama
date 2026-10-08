import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const PackageManifestSchema = z.object({ version: z.string().optional() });

let packageVersion: string | undefined;

/**
 * Installed Nakama app version for operators (not the API contract number).
 * Prefer `NAKAMA_VERSION` (Docker/release), else root `package.json` `version`.
 */
export function getNakamaVersion(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.NAKAMA_VERSION?.trim().replace(/^v/i, "");

  if (fromEnv) {
    return fromEnv;
  }

  if (packageVersion === undefined) {
    try {
      const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

      const manifest = PackageManifestSchema.parse(
        JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
      );

      const version = manifest.version?.trim().replace(/^v/i, "");

      packageVersion = version || "dev";
    } catch {
      packageVersion = "dev";
    }
  }

  return packageVersion;
}
