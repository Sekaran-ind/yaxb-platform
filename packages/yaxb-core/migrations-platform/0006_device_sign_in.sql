-- Signing a device in (IDN-17, 18, 41): the CLI, a box or a voice device asks for a code, a person
-- approves it on a device that is signed in, and the device gets its own credential. Only hashes of
-- the codes and the credential are kept. Each credential is revoked on its own.
CREATE TABLE IF NOT EXISTS device_grants (
  id TEXT PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code_hash TEXT NOT NULL UNIQUE,
  client TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  account_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_credentials (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  secret_hash TEXT NOT NULL,
  client TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS device_credentials_account ON device_credentials (account_id);
