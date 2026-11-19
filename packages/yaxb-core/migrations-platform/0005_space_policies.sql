-- A space's sign-in rules (IDN-34), set by its administrator: which methods open it, whether staff
-- (members with roles) must use a passkey, and how long a sign-in lasts there before signing in again.
CREATE TABLE IF NOT EXISTS space_policies (
  edition TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  methods TEXT NOT NULL,
  staff_passkeys INTEGER NOT NULL DEFAULT 0,
  session_hours INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (edition, tenant_id)
);
