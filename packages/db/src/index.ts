import { createSqliteDatabase, type SqliteDatabase } from "./adapters/sqlite";
import {
  type ResolveDatabasePathOptions,
  resolveDatabasePath,
} from "./database-url";

/** Same as `createSqliteMemoryAdapter` — kept for existing test imports. */
export {
  createSqliteDatabase,
  createSqliteMemoryAdapter,
  createSqliteMemoryAdapter as createInMemoryDatabaseAdapter,
} from "./adapters/sqlite";
export * from "./automation-store";
export * from "./constants";
export type { ResolveDatabasePathOptions } from "./database-url";
export * from "./local-client";
export * from "./org-profiles";
export * from "./seed";
export * from "./types";
export * from "./workflow-store";
export * from "./workspace-settings";

export type Database = SqliteDatabase;

export async function createDatabase(
  databaseUrl: string,
  options: ResolveDatabasePathOptions = {}
): Promise<Database> {
  const databasePath = resolveDatabasePath(databaseUrl, options);

  if (databasePath === ":memory:") {
    return createSqliteDatabase(":memory:");
  }

  return createSqliteDatabase(`file:${databasePath}`);
}

export type { SqliteDatabase };
