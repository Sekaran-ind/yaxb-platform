-- Public keys of members' devices (step access, sealed steps; cases/sealed.ts). A step that not
-- everyone may read travels in a case encrypted for the devices of the people who may read it; this
-- is the directory those devices are found in. Public keys only (a key with a private part is
-- refused). One member may have a few devices. 'admin' is the administrator's own.
CREATE TABLE IF NOT EXISTS member_keys (
  tenant_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  jwk TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, member_id, key_id)
);
CREATE INDEX IF NOT EXISTS member_keys_member ON member_keys (tenant_id, member_id, created_at);
