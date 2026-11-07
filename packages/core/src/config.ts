export function readEnvValue(
  env: Record<string, string | undefined>,
  key: string
): string | undefined {
  const value = env[key]?.trim();

  if (value) {
    return value;
  }

  const filePath = env[`${key}_FILE`]?.trim();

  if (!filePath) {
    return;
  }

  const { readFileSync } = process.getBuiltinModule("node:fs");

  return readFileSync(filePath, "utf8").trim() || undefined;
}

type ManagedSecretResolver = (
  scope: string,
  name: string,
  envNames: string[]
) => Promise<string | null>;

let managedSecretResolver: ManagedSecretResolver = async (
  _scope,
  _name,
  envNames
) =>
  envNames.map((name) => readEnvValue(process.env, name)).find(Boolean) ?? null;

export function setManagedSecretResolver(
  resolver: ManagedSecretResolver
): void {
  managedSecretResolver = resolver;
}

export function resolveManagedSecret(
  scope: string,
  name: string,
  envNames: string[] = []
): Promise<string | null> {
  return managedSecretResolver(scope, name, envNames);
}

/** The slice of the server's ManagedSecrets that channel config writes through. */
export type ManagedSecretWriter = {
  delete(scope: string, name: string): Promise<void>;
  migrate(scope: string, name: string, value: string): Promise<void>;
  save(scope: string, name: string, value: string): Promise<void>;
};

let managedSecretWriter: ManagedSecretWriter | null = null;

/** Set by the server when NAKAMA_SECRETS_KEY is configured; unset means plaintext. */
export function setManagedSecretWriter(
  writer: ManagedSecretWriter | null
): void {
  managedSecretWriter = writer;
}

export function getManagedSecretWriter(): ManagedSecretWriter | null {
  return managedSecretWriter;
}

export interface AppConfig {
  databaseUrl: string;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): AppConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? "file:data/sqlite/nakama.sqlite",
  };
}
