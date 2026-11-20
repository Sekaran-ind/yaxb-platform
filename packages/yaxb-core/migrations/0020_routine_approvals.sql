-- Routines' actions that wait for a person's approval (RTN-6): a message, a connector call or a
-- webhook, rendered when the routine ran, kept until a member of the role approves or declines it
-- (undecided ones are dropped after 14 days). The payload is what will be sent, nothing more.
CREATE TABLE IF NOT EXISTS routine_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  routine_id TEXT NOT NULL,
  routine_title TEXT NOT NULL,
  run_id TEXT NOT NULL,
  action INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('message', 'connector', 'webhook')),
  role TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('approved', 'declined')),
  decided_by TEXT,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS routine_approvals_role ON routine_approvals (tenant_id, role, created_at);
