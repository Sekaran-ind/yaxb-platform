-- The Service Catalogue (LIB-14..20): each service has an owner (a member, the administrator, or a
-- guest's session), so anyone can design services and only they (or editors) change them; the
-- audit log is read per service.
ALTER TABLE library_entries ADD COLUMN owner_id TEXT;
ALTER TABLE library_entries ADD COLUMN owner_name TEXT;
CREATE INDEX IF NOT EXISTS library_entries_owner ON library_entries (owner_id);
CREATE INDEX IF NOT EXISTS audit_target ON audit (target_id, at);
