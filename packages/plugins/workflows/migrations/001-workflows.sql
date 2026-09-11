CREATE TABLE workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  lease_until INTEGER
);
CREATE INDEX runs_workflow ON runs(workflow_id);
CREATE UNIQUE INDEX one_running_workflow ON runs(workflow_id) WHERE lease_until IS NOT NULL;
CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX steps_run ON steps(run_id, position);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
