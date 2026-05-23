import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";

export function migrateDatabase(db: Database): void {
  const schemaPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../sql/schema.sql",
  );
  const sql = readFileSync(schemaPath, "utf8");

  db.exec(sql);
}
