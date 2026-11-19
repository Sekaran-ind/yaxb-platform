-- Connectors (CNX-2, CNX-8): a catalogue entry may be a connector (a REST API described in YAML,
-- reviewed and published like a service). library_entries is rebuilt with 'connector' allowed, the
-- same way 0016 added 'organisation' (SQLite can't change a CHECK). Connector secrets (CNX-3) are
-- kept per tenant, sealed, and never sent to a browser.
PRAGMA defer_foreign_keys = on;

CREATE TABLE library_entries_new (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries (id),
  kind TEXT NOT NULL CHECK (kind IN ('service', 'journey', 'questionnaire', 'organisation', 'connector')),
  doc_id TEXT NOT NULL,
  title TEXT NOT NULL,
  yaml TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'in_review', 'accepted', 'rejected', 'archived')),
  revision INTEGER NOT NULL,
  published_yaml TEXT,
  published_revision INTEGER,
  submitted_by TEXT,
  submitted_by_name TEXT,
  submitted_at TEXT,
  reviewed_by TEXT,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_name TEXT,
  owner_id TEXT,
  owner_name TEXT,
  storage TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default'
);

INSERT INTO library_entries_new (id, library_id, kind, doc_id, title, yaml, status, revision, published_yaml, published_revision, submitted_by, submitted_by_name, submitted_at, reviewed_by, reviewed_by_name, reviewed_at, review_note, created_at, updated_at, updated_by_name, owner_id, owner_name, storage, tenant_id)
SELECT id, library_id, kind, doc_id, title, yaml, status, revision, published_yaml, published_revision, submitted_by, submitted_by_name, submitted_at, reviewed_by, reviewed_by_name, reviewed_at, review_note, created_at, updated_at, updated_by_name, owner_id, owner_name, storage, tenant_id
FROM library_entries;

CREATE TABLE library_revisions_new (
  entry_id TEXT NOT NULL REFERENCES library_entries_new (id),
  revision INTEGER NOT NULL,
  yaml TEXT NOT NULL,
  at TEXT NOT NULL,
  by_id TEXT,
  by_name TEXT,
  note TEXT,
  PRIMARY KEY (entry_id, revision)
);
INSERT INTO library_revisions_new (entry_id, revision, yaml, at, by_id, by_name, note)
SELECT entry_id, revision, yaml, at, by_id, by_name, note FROM library_revisions;

DROP TABLE library_revisions;
DROP TABLE library_entries;
-- Renaming the new entries table also renames the revisions' reference to it.
ALTER TABLE library_entries_new RENAME TO library_entries;
ALTER TABLE library_revisions_new RENAME TO library_revisions;

CREATE INDEX IF NOT EXISTS library_entries_library ON library_entries (library_id, kind);
CREATE INDEX IF NOT EXISTS library_entries_status ON library_entries (status);
CREATE INDEX IF NOT EXISTS library_entries_owner ON library_entries (owner_id);
CREATE INDEX IF NOT EXISTS library_entries_tenant ON library_entries (tenant_id, kind);

CREATE TABLE IF NOT EXISTS connector_secrets (
  tenant_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sealed TEXT NOT NULL,
  set_at TEXT NOT NULL,
  set_by TEXT,
  PRIMARY KEY (tenant_id, connector_id, name)
);
