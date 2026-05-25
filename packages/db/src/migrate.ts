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
  migrateAutomationsTable(db);
}

function migrateAutomationsTable(db: Database): void {
  const columns = db
    .prepare("PRAGMA table_info(automations)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("profile_id")) {
    db.exec(`
      ALTER TABLE automations ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'profile_default';
    `);
  }

  if (!columnNames.has("enabled")) {
    db.exec(`
      ALTER TABLE automations ADD COLUMN enabled INTEGER DEFAULT 1 NOT NULL;
    `);
  }
}
