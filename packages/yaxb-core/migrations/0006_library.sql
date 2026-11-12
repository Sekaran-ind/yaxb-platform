-- The journey library (src/library, LIB-1..12): libraries of services, journeys and questionnaires,
-- each entry with its revisions and its review, and the organisation's own roles.
-- Built-in roles (Admin, Moderator, Reviewer) are in code, not here.
CREATE TABLE IF NOT EXISTS library_roles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One document per entry. `yaml` is the latest revision; `published_yaml` is the version a
-- reviewer accepted, which the kiosk serves even while a newer revision is being edited.
CREATE TABLE IF NOT EXISTS library_entries (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries (id),
  kind TEXT NOT NULL CHECK (kind IN ('service', 'journey', 'questionnaire')),
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
  updated_by_name TEXT
);
CREATE INDEX IF NOT EXISTS library_entries_library ON library_entries (library_id, kind);
CREATE INDEX IF NOT EXISTS library_entries_status ON library_entries (status);

CREATE TABLE IF NOT EXISTS library_revisions (
  entry_id TEXT NOT NULL REFERENCES library_entries (id),
  revision INTEGER NOT NULL,
  yaml TEXT NOT NULL,
  at TEXT NOT NULL,
  by_id TEXT,
  by_name TEXT,
  note TEXT,
  PRIMARY KEY (entry_id, revision)
);
