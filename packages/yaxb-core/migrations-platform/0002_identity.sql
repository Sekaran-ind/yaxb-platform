-- Identity (docs/specs/15-identity.md IDN-1..6, 11, 50..54) and spaces (SPC-1..10): one account per
-- person, behind their profile, with its sign-in methods and its memberships, shared by every
-- edition through the platform database (PLA-2). Keep the least (IDN-52): no names beyond what the
-- person chose to show, phone numbers and emails only as keyed hashes plus a masked form, tokens and
-- codes only as hashes. Never a profile's passphrase or contents (IDN-4).
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- How a person signs in: kind phone (OTP), email, passkey, oidc, member_key. `subject_hash` is an HMAC
-- of the phone number, email address or provider subject, so a lookup works without keeping it.
CREATE TABLE IF NOT EXISTS account_methods (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  kind TEXT NOT NULL CHECK (kind IN ('phone', 'email', 'passkey', 'oidc', 'member_key')),
  subject_hash TEXT NOT NULL,
  display TEXT NOT NULL,
  public_key TEXT,
  counter INTEGER,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS account_methods_subject ON account_methods (kind, subject_hash);
CREATE INDEX IF NOT EXISTS account_methods_account ON account_methods (account_id);

-- Spaces (SPC-1): the person's place in a family, business or community, on one edition, with their
-- roles there. The space's name and kind are kept for the picker: the platform database can't read
-- an edition's own database.
CREATE TABLE IF NOT EXISTS memberships (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  edition TEXT NOT NULL CHECK (edition IN ('family', 'business', 'community', 'all')),
  tenant_id TEXT NOT NULL,
  space_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('family', 'business', 'community')),
  roles TEXT NOT NULL,
  member_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, edition, tenant_id)
);
CREATE INDEX IF NOT EXISTS memberships_space ON memberships (edition, tenant_id);

-- Sessions (IDN-50): short access tokens signed with the keys below, and a refresh token that
-- rotates on every use. `prev_hash` is the refresh token before the current one: presenting it again
-- means it was copied, and the whole session ends.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  refresh_hash TEXT NOT NULL,
  prev_hash TEXT,
  method TEXT NOT NULL,
  level INTEGER NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh ON sessions (refresh_hash);
CREATE INDEX IF NOT EXISTS sessions_prev ON sessions (prev_hash);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);

-- One-time codes (IDN-11, IDN-12): the code's keyed hash, its attempts and when it ends.
CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS otp_challenges_subject ON otp_challenges (subject_hash, created_at);

-- Signing keys (IDN-50): ES256, rotated; the private key sealed with the Worker's IDENTITY_SECRET.
-- Every edition's Worker and the box verify sessions with the public keys (the JWKS).
CREATE TABLE IF NOT EXISTS signing_keys (
  kid TEXT PRIMARY KEY,
  public_jwk TEXT NOT NULL,
  sealed_private TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retired_at TEXT
);

-- Rate limits and lockout (IDN-51): counts per key (a number's hash, an address) per window.
CREATE TABLE IF NOT EXISTS identity_counters (
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- The identity audit (IDN-53, SPC-10): facts only, never a number, an address or a code.
CREATE TABLE IF NOT EXISTS identity_audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  account_id TEXT,
  action TEXT NOT NULL,
  details TEXT
);
CREATE INDEX IF NOT EXISTS identity_audit_account ON identity_audit (account_id, at);
