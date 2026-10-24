import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Environment for a server started from a source checkout. Deployments set
 * NAKAMA_SECRETS_KEY themselves; local development gets one key per machine,
 * created on first start and reused after. The file sits outside the data
 * directory (`~/.nakama`), so its exports and backups never carry the key.
 * Deleting it makes the secrets saved in Settings unreadable.
 */
export function withDevSecretsKey(
  env: NodeJS.ProcessEnv = process.env,
  path = join(
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"),
    "nakama",
    "dev-secrets.env"
  )
): NodeJS.ProcessEnv {
  if (env.NAKAMA_SECRETS_KEY) {
    return env;
  }

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
    // `wx` never overwrites a key another start just created.
    writeFileSync(
      path,
      `NAKAMA_SECRETS_KEY=${randomBytes(32).toString("base64")}\n`,
      { flag: "wx", mode: 0o600 }
    );
    console.warn(
      `Created a local NAKAMA_SECRETS_KEY in ${path}. Keep this file: secrets saved in Settings need it.`
    );
  }

  const key = readFileSync(path, "utf8").match(
    /^NAKAMA_SECRETS_KEY=(.+)$/m
  )?.[1];

  if (!key) {
    throw new Error(`${path} has no NAKAMA_SECRETS_KEY line.`);
  }

  return { ...env, NAKAMA_SECRETS_KEY: key.trim() };
}
