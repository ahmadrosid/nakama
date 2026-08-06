import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { createSqliteDatabase, type SqliteDatabase } from "./adapters/sqlite";
import {
  resolveDatabasePath,
  type ResolveDatabasePathOptions,
} from "./database-url";
import type { DatabaseAdapter } from "./types";

export type { ResolveDatabasePathOptions } from "./database-url";

export * from "./automation-store";
export * from "./constants";
export * from "./local-client";
export * from "./org-profiles";
export * from "./seed";
export * from "./types";
export { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
export { createSqliteDatabase } from "./adapters/sqlite";

export interface Database {
  adapter: DatabaseAdapter;
  close(): void;
  /** Re-open the on-disk database after files under the data root were replaced. */
  reopen(): Promise<void>;
}

export async function createDatabase(
  databaseUrl: string,
  options: ResolveDatabasePathOptions = {},
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
