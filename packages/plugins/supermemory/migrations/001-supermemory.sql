CREATE TABLE dataset (id INTEGER PRIMARY KEY CHECK (id = 1), namespace TEXT NOT NULL, org_id TEXT NOT NULL);
CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'knowledge')),
  operation_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  upstream_id TEXT,
  custom_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (profile_id, kind, operation_key)
);
CREATE INDEX receipts_profile_kind ON receipts(profile_id, kind, created_at);
CREATE UNIQUE INDEX receipts_upstream ON receipts(kind, upstream_id) WHERE upstream_id IS NOT NULL;
