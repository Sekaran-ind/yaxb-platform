-- Usage limits (the free tier's questions per IP, the daily model budget, failed case-reference
-- guesses): a sliding log of uses. `key` is a purpose and a hashed address, never an address.
CREATE TABLE IF NOT EXISTS quota_hits (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quota_hits_key ON quota_hits (key, at);
