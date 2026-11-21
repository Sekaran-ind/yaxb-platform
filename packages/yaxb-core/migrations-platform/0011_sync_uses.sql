-- The free plan's syncs from a device to the server (docs/architecture/hardening.md "Data lifetime and
-- trust"): 5 a year per account, counted here. One row per sync; the count is the rows in the last
-- 365 days, and older rows are deleted as the account syncs. Facts only: an account id and a time.
CREATE TABLE IF NOT EXISTS sync_uses (
  account_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_uses_account ON sync_uses (account_id, at);
