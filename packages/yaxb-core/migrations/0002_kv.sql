-- The agent's long-term store on D1 (src/stores/d1.ts createD1Kv): Deep Agents' StoreBackend keeps
-- /memories/ here when storage is "server". Namespaces are joined with ".".
CREATE TABLE IF NOT EXISTS kv (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS kv_updated_at ON kv (updated_at);
