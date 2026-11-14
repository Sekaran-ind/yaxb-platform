-- Cases (LIB-42..48): who a case is assigned to (a moderator's reassignment) and the device a
-- visitor started it on; and the cloud relay, which is transient: it holds an envelope (a case on
-- its way to the next device) only until it is picked up or expires, then deletes it. Beacons tell
-- moderators who holds which case: a reference, titles, a role, a holder; never answers or notes.
ALTER TABLE cases ADD COLUMN starter_device TEXT;
ALTER TABLE cases ADD COLUMN assignee TEXT;
ALTER TABLE cases ADD COLUMN assignee_name TEXT;
CREATE TABLE IF NOT EXISTS relay_envelopes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  to_roles TEXT,
  to_member TEXT,
  to_device TEXT,
  from_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  picked_by TEXT
);
CREATE INDEX IF NOT EXISTS relay_envelopes_expires ON relay_envelopes (expires_at);
CREATE TABLE IF NOT EXISTS relay_beacons (
  case_id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS relay_beacons_expires ON relay_beacons (expires_at);
