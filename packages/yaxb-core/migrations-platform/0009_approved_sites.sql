-- Approved sites (SIT-1..6): every outside site Anjal reads comes from an approved list. Two tiers in
-- one table: the platform's (tenant_id NULL, kept by the platform's moderators) and each business's
-- own. A business's row for a platform site with status 'off' switches it off there (never looser).
-- Requests are merged by site and use, and name a business or "a family", never a person.
CREATE TABLE IF NOT EXISTS approved_sites (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  paths TEXT NOT NULL,
  region TEXT NOT NULL,
  category TEXT NOT NULL,
  uses TEXT NOT NULL,
  edition TEXT,
  tenant_id TEXT,
  status TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  review_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approved_sites_origin ON approved_sites (origin);
CREATE TABLE IF NOT EXISTS site_requests (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  use TEXT NOT NULL,
  reason TEXT,
  asked_by_label TEXT NOT NULL,
  asked_by TEXT NOT NULL,
  edition TEXT,
  tenant_id TEXT,
  count INTEGER NOT NULL,
  status TEXT NOT NULL,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_requests_open ON site_requests (status, origin, use);
CREATE TABLE IF NOT EXISTS site_audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  origin TEXT NOT NULL,
  details TEXT
);
