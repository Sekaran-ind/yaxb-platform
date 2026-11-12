-- Session feedback (src/feedback): "How is YAXB doing this session?" Bad, Fine, Good or skipped.
-- Nothing identifies the visitor, and the conversation is never stored.
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  rating TEXT NOT NULL CHECK (rating IN ('bad', 'fine', 'good', 'skipped')),
  comment TEXT,
  mode TEXT NOT NULL,
  language TEXT NOT NULL,
  profile INTEGER NOT NULL,
  answers INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_created_at ON feedback (created_at);
