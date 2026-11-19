-- A device kept for one space (SPC-5): a shop's front desk, a society's lobby kiosk. The device holds
-- `<id>.<secret>`; only the secret's keyed hash is kept. A locked device opens no other space, and
-- only that space's administrator releases it (here, or from another device by its id).
CREATE TABLE IF NOT EXISTS device_locks (
  id TEXT PRIMARY KEY,
  edition TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  space_name TEXT NOT NULL,
  label TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  locked_by TEXT,
  created_at TEXT NOT NULL,
  unlocked_at TEXT
);
CREATE INDEX IF NOT EXISTS device_locks_space ON device_locks (edition, tenant_id);
