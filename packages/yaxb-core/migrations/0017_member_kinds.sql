-- Member keys for machines (IDN-16) and people who sign in with an account (IDN-44).
-- kind: 'person' (default) or 'machine'. A machine has scopes (JSON list) and calls the API with its
-- key as a bearer token; it never signs in like a person and holds no roles. linked_at: when a
-- person's member record was linked to their account; from then on their key no longer signs in.
ALTER TABLE moderators ADD COLUMN kind TEXT NOT NULL DEFAULT 'person';
ALTER TABLE moderators ADD COLUMN scopes TEXT;
ALTER TABLE moderators ADD COLUMN linked_at TEXT;
