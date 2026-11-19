-- The audit log's hash chain (AUD-2, src/moderators auditHash): each record carries the hash of the
-- tenant's record before it and its own. audit_heads keeps each tenant's newest hash and count; a
-- record is only inserted while the head is the one its hash was made from (stores/d1.ts audit).
ALTER TABLE audit ADD COLUMN prev_hash TEXT;
ALTER TABLE audit ADD COLUMN hash TEXT;
CREATE TABLE IF NOT EXISTS audit_heads (
  tenant_id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0
);
-- One record per place in the chain: a second record after the same one can't be written.
CREATE UNIQUE INDEX IF NOT EXISTS audit_chain ON audit (tenant_id, prev_hash) WHERE hash IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS audit_chain_head AFTER INSERT ON audit WHEN NEW.hash IS NOT NULL
BEGIN
  INSERT INTO audit_heads (tenant_id, hash, n) VALUES (NEW.tenant_id, NEW.hash, 1)
  ON CONFLICT (tenant_id) DO UPDATE SET hash = NEW.hash, n = n + 1;
END;
