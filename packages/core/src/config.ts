export * from "./user-config";
export * from "./runtime";

export function readEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

export interface AppConfig {
  databaseUrl: string;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? "file:data/sqlite/tinyclaw.sqlite",
  };
}
