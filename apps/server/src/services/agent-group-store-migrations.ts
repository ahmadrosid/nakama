import type { Database } from "bun:sqlite";

/** Brings a group database from any earlier release up to the current columns. */
export function migrateGroupDatabase(db: Database): void {
  addThreadColumn(db);
  addBriefColumn(db);
  addDocumentsColumn(db);
  addMemoryChangesColumn(db);
}

/** Threads came after the first release, so older files lack the column. */
function addThreadColumn(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(messages)")
    .all();

  if (!columns.some((column) => column.name === "thread_root_id")) {
    db.exec(
      `ALTER TABLE messages ADD COLUMN thread_root_id INTEGER;
        CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_root_id, id);`
    );
  }
}

/** Briefs came after the first release, so older files lack the column. */
function addBriefColumn(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(groups)")
    .all();

  if (!columns.some((column) => column.name === "brief")) {
    db.exec("ALTER TABLE groups ADD COLUMN brief TEXT NOT NULL DEFAULT ''");
  }
}

/** Attachments came after the first release, so older files lack the column. */
function addDocumentsColumn(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(messages)")
    .all();

  if (!columns.some((column) => column.name === "documents")) {
    db.exec("ALTER TABLE messages ADD COLUMN documents TEXT");
  }
}

/** Older messages have no recorded memory changes. */
function addMemoryChangesColumn(db: Database): void {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(messages)")
    .all();

  if (!columns.some((column) => column.name === "memory_changes")) {
    db.exec("ALTER TABLE messages ADD COLUMN memory_changes TEXT");
  }
}
