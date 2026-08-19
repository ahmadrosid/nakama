import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { createSqliteDatabase, type SqliteDatabase } from "./adapters/sqlite";
import {
  type ResolveDatabasePathOptions,
  resolveDatabasePath,
} from "./database-url";
import type { DatabaseAdapter } from "./types";

export { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
export { createSqliteDatabase } from "./adapters/sqlite";
export * from "./automation-store";
export * from "./constants";
export type { ResolveDatabasePathOptions } from "./database-url";
export * from "./local-client";
export * from "./org-profiles";
export * from "./seed";
export * from "./types";
export * from "./workspace-settings";

export interface Database {
  adapter: DatabaseAdapter;
  close(): void;
  /** Re-open the on-disk database after files under the data root were replaced. */
  reopen(): Promise<void>;
}

export async function createDatabase(
  databaseUrl: string,
  options: ResolveDatabasePathOptions = {}
): Promise<Database> {
  const databasePath = resolveDatabasePath(databaseUrl, options);

  if (databasePath === ":memory:") {
    return {
      adapter: createInMemoryDatabaseAdapter(),
      close() {},
      async reopen() {},
    };
  }

  return createSqliteDatabase(`file:${databasePath}`);
}

export type { SqliteDatabase };
