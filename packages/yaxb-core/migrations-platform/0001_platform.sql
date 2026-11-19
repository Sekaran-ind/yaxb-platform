-- anjal-platform (PLA-1): the one database every edition's Worker binds as PLATFORM_DB, beside its
-- own DB. Only records that cross editions go here (PLA-2): accounts and their sign-in methods
-- (15), the approved-sites catalogue (14), email routing (16) and the directory. Each arrives with
-- its feature, in its own migration; every query names the tenant and the edition (PLA-4).
CREATE TABLE IF NOT EXISTS platform_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO platform_meta (key, value, updated_at) VALUES ('schema', '1', '2026-11-19T00:00:00.000Z');
