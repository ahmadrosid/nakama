import { createSqliteDatabase, type SqliteDatabase } from "./adapters/sqlite";
import {
  type ResolveDatabasePathOptions,
  resolveDatabasePath,
} from "./database-url";

/** Same as `createSqliteMemoryAdapter` — kept for existing test imports. */
export {
  createSqliteDatabase,
  createSqliteMemoryAdapter as createInMemoryDatabaseAdapter,
} from "./adapters/sqlite";

export * from "./automation-store";

export * from "./constants";

export {
  type ResolveDatabasePathOptions,
  resolveDatabasePath,
} from "./database-url";

export * from "./local-client";

export {
  AUDIT_EVENT_MAX_RETENTION_DAYS,
  AUDIT_EVENT_MIN_RETENTION_DAYS,
  AUDIT_EVENT_RETENTION_DAYS,
} from "./migrate";

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
