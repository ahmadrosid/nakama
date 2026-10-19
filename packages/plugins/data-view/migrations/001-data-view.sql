CREATE TABLE sheets (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  spreadsheet_id TEXT NOT NULL,
  gid TEXT NOT NULL,
  title TEXT NOT NULL,
  tab_title TEXT,
  base TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  synced_at INTEGER
);
