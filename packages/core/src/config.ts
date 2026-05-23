export * from "./user-config";
export * from "./runtime";

export type AutomationStorageMode = "db" | "file";

export interface AppConfig {
  appName: string;
  environment: string;
  databaseUrl: string;
  automationStorage: AutomationStorageMode;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  return {
    appName: env.TINYCLAW_APP_NAME ?? "TinyClaw",
    environment: env.NODE_ENV ?? "development",
    databaseUrl: env.DATABASE_URL ?? "file:data/sqlite/tinyclaw.sqlite",
    automationStorage: env.AUTOMATION_STORAGE === "file" ? "file" : "db",
  };
}
