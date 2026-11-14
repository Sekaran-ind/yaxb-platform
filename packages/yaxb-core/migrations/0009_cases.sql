-- Cases (LIB-12, LIB-33..38): a catalogue journey handed between people, with its thread. `run`
-- holds the answers so far (never passwords) and `journey` the journey as it was when the case
-- started, both JSON. Answers may hold personal details: the Worker shows a case only to its
-- starter, members with a role the journey names, and administrators.
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  entry_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_title TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  journey_title TEXT NOT NULL,
  revision INTEGER,
  status TEXT NOT NULL,
  waiting_step TEXT,
  waiting_role TEXT,
  finish_roles TEXT NOT NULL,
  roles TEXT NOT NULL,
  started_by TEXT NOT NULL,
  started_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  result TEXT,
  run TEXT NOT NULL,
  journey TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_status ON cases (status, updated_at);
CREATE INDEX IF NOT EXISTS cases_started_by ON cases (started_by, updated_at);
CREATE TABLE IF NOT EXISTS case_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  step TEXT,
  text TEXT
);
CREATE INDEX IF NOT EXISTS case_events_case ON case_events (case_id, at);
