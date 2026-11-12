-- Moderators, their keys (hashed), profiles and the audit log (src/moderators, MOD-20..25).
-- A key is stored only as its SHA-256; the key itself is shown once, when it is issued.
CREATE TABLE IF NOT EXISTS moderators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  label TEXT,
  roles TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_seen_at TEXT,
  reviews INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS moderator_profiles (
  moderator_id TEXT PRIMARY KEY REFERENCES moderators (id),
  display_name TEXT NOT NULL,
  languages TEXT NOT NULL,
  sources TEXT NOT NULL,
  preferences TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Who did what, when: metadata only, never what was reviewed or asked.
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  details TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit (at);
CREATE INDEX IF NOT EXISTS audit_actor ON audit (actor_id, at);
