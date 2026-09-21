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
