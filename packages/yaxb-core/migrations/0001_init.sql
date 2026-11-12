-- yaxb-core storage on Cloudflare D1 (src/stores/d1.ts).

-- One row per conversation: serialized messages, todos and virtual files (ThreadState).
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_updated_at ON threads (updated_at);

-- Questions the agent escalated for human review.
CREATE TABLE IF NOT EXISTS moderation (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS moderation_created_at ON moderation (created_at);
