-- The Service Designer agent (LIB-27..32): its drafts (never the narrative they came from), the
-- catalogue entry each became and what the reviewer decided, and the lessons it learns from that.
CREATE TABLE IF NOT EXISTS design_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT,
  draft_yaml TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  entry_id TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS design_runs_entry ON design_runs (entry_id);
CREATE TABLE IF NOT EXISTS design_lessons (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  decision TEXT,
  entry_id TEXT,
  run_id TEXT,
  created_at TEXT NOT NULL,
  created_by_name TEXT
);
CREATE INDEX IF NOT EXISTS design_lessons_at ON design_lessons (created_at);
