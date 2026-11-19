-- A business's own sign-in (IDN-15): its OpenID Connect provider (Entra ID, Google Workspace, Okta,
-- Keycloak), set by the space's administrator. The client secret is sealed with IDENTITY_SECRET and
-- never leaves the server. New staff who sign in with it join the space with `default_role`.
CREATE TABLE IF NOT EXISTS space_oidc (
  edition TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  sealed_secret TEXT NOT NULL,
  label TEXT NOT NULL,
  default_role TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (edition, tenant_id)
);
