-- Joining a space with a code (SPC-8, IDN-40): a join request that waits for the space's
-- administrator, kept with the account so the space is added by itself once they accept. The claim
-- that collects the membership is sealed with IDENTITY_SECRET; nothing else about the request is kept.
CREATE TABLE IF NOT EXISTS pending_joins (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  edition TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  space_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_id TEXT NOT NULL,
  sealed_claim TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_joins_account ON pending_joins (account_id);
