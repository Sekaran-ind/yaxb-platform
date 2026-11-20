-- Business links (DEP-2, DEP-4, DEP-5): one business lets another use some of its services as a
-- dependency. Both are tenants of this edition's database. `offers` is the provider's consent as JSON
-- ([{ service, journey, accepts: Order | Invoice }]), versioned.
CREATE TABLE IF NOT EXISTS business_links (
  id TEXT PRIMARY KEY,
  requester TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL,
  offers TEXT NOT NULL,
  consent_version INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  ended_by TEXT
);
CREATE INDEX IF NOT EXISTS business_links_requester ON business_links (requester, status);
CREATE INDEX IF NOT EXISTS business_links_provider ON business_links (provider, status);
-- Cases belong to a business (tenant): a partner's request lives in the partner's own list.
ALTER TABLE cases ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS cases_tenant ON cases (tenant_id, status);
