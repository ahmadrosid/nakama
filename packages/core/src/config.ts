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
