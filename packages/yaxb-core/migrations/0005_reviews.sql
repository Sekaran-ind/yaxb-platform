-- Answer reviews, and the handled state of escalated questions (src/reviews, MOD-4, MOD-10..13).

-- MOD-4: a moderator marks an escalated question handled, with a note.
ALTER TABLE moderation ADD COLUMN state TEXT NOT NULL DEFAULT 'open';
ALTER TABLE moderation ADD COLUMN note TEXT;
ALTER TABLE moderation ADD COLUMN handled_by TEXT;
ALTER TABLE moderation ADD COLUMN handled_at TEXT;

-- Answers sent for review: the question, the answer, the sources it cited and its notebook.
CREATE TABLE IF NOT EXISTS review_answers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  origin TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  refs TEXT NOT NULL,
  notebook_id TEXT,
  notebook_title TEXT,
  mode TEXT NOT NULL,
  language TEXT,
  state TEXT NOT NULL CHECK (state IN ('open', 'reviewed'))
);
CREATE INDEX IF NOT EXISTS review_answers_created ON review_answers (created_at);
CREATE INDEX IF NOT EXISTS review_answers_notebook ON review_answers (notebook_id, created_at);

-- Every review is kept; a later review names the one it replaces (MOD-13).
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES review_answers (id),
  at TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  moderator_name TEXT NOT NULL,
  rating TEXT NOT NULL,
  marks TEXT NOT NULL,
  missing TEXT NOT NULL,
  context TEXT NOT NULL,
  proposal TEXT,
  replaces TEXT
);
CREATE INDEX IF NOT EXISTS reviews_answer ON reviews (answer_id, at);
CREATE INDEX IF NOT EXISTS reviews_replaces ON reviews (replaces);
