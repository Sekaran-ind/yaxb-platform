-- The Service Designer as a conversation (LIB-39..41): each service's design thread, what people
-- asked and the agent's replies (its notes and drafts). A new service's thread starts unlinked (its
-- starter's) and is linked to the entry created from it. It describes a service, not a person.
CREATE TABLE IF NOT EXISTS design_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  entry_id TEXT,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  yaml TEXT,
  ok INTEGER,
  run_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS design_messages_thread ON design_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS design_messages_entry ON design_messages (entry_id);
