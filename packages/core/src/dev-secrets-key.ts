import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY_LINE = /^NAKAMA_SECRETS_KEY=(.+)$/m;

/** Outside the data directory (`~/.nakama`), so exports and backups of it never carry the key. */
function defaultDevSecretsPath(): string {
  const configHome =
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");

  return join(configHome, "nakama", "dev-secrets.env");
}

/**
 * Environment for a server started from a source checkout. Deployments set
 * NAKAMA_SECRETS_KEY themselves; local development gets one key per machine,
 * created on first start in `~/.config/nakama/dev-secrets.env` and reused
 * after. Deleting that file makes the secrets saved in Settings unreadable.
 */
export function withDevSecretsKey(
  env: NodeJS.ProcessEnv = process.env,
  path = defaultDevSecretsPath()
): NodeJS.ProcessEnv {
  if (env.NAKAMA_SECRETS_KEY) {
    return env;
  }

  return { ...env, NAKAMA_SECRETS_KEY: readOrCreateKey(path) };
}

function readOrCreateKey(path: string): string {
  const existing = readKey(path);

  if (existing) {
    return existing;
  }

  const key = randomBytes(32).toString("base64");
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });

  try {
    // `wx` never overwrites: a key another process just created wins.
    writeFileSync(path, `NAKAMA_SECRETS_KEY=${key}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    const raced = readKey(path);

    if (raced) {
      return raced;
    }

    throw error;
  }

  console.warn(
    `Created a local NAKAMA_SECRETS_KEY in ${path}. Keep this file: secrets saved in Settings need it.`
  );

  return key;
}

function readKey(path: string): string | null {
  try {
    return readFileSync(path, "utf8").match(KEY_LINE)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}
