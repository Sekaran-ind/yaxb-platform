-- Tenants and join tokens (TEN-1..8): each business in the directory is a tenant with its own
-- members and catalogue. Everything that existed before belongs to the 'default' tenant.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'business',
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')) DEFAULT 'active',
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO tenants (id, slug, name, kind, status, created_at) VALUES ('default', 'default', 'This organisation', 'business', 'active', '2026-11-15T00:00:00.000Z');

ALTER TABLE moderators ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS moderators_tenant ON moderators (tenant_id);
ALTER TABLE audit ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS audit_tenant ON audit (tenant_id, at);
ALTER TABLE libraries ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS libraries_tenant ON libraries (tenant_id);
ALTER TABLE library_entries ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS library_entries_tenant ON library_entries (tenant_id, kind);

-- Roles are named by each business: the same id may exist in two tenants.
CREATE TABLE library_roles_t (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
INSERT INTO library_roles_t (tenant_id, id, label, description, created_at) SELECT 'default', id, label, description, created_at FROM library_roles;
DROP TABLE library_roles;
ALTER TABLE library_roles_t RENAME TO library_roles;

-- A join link an administrator issues for a role; only its hash is kept.
CREATE TABLE IF NOT EXISTS join_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  label TEXT,
  uses_left INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS join_tokens_tenant ON join_tokens (tenant_id);

-- Someone who opened a join link: pending until an administrator decides. Accepting authorises;
-- the member and their key are created when the person collects it with their claim code (only
-- its hash is kept), so the key is shown once and never stored.
CREATE TABLE IF NOT EXISTS join_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  claim_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'collected')),
  member_id TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS join_requests_tenant ON join_requests (tenant_id, status);
