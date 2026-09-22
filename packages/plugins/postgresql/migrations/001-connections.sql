CREATE TABLE tenant (id INTEGER PRIMARY KEY CHECK (id=1), org_id TEXT NOT NULL);
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  config TEXT NOT NULL,
  secret TEXT NOT NULL
);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  profile_id TEXT,
  connection_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
