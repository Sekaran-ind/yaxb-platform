-- Service storage and events (MET-1..2): where a service records what happens to its journeys
-- (none, the organisation's box, or the server on the paid plan), and the events themselves when
-- it is the server. An event is a fact (which journey, screen, when, how long, the role it went to,
-- a staff member's name for their own actions), never what anyone answered.
ALTER TABLE library_entries ADD COLUMN storage TEXT;
CREATE TABLE IF NOT EXISTS service_events (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  journey TEXT NOT NULL,
  kind TEXT NOT NULL,
  step TEXT,
  role TEXT,
  run TEXT NOT NULL,
  at TEXT NOT NULL,
  ms INTEGER,
  ok INTEGER,
  actor TEXT
);
CREATE INDEX IF NOT EXISTS service_events_service ON service_events (service, at);
