-- Data lifetime (stores/lifetime.ts): the daily purge deletes across all businesses by creation time
-- (30 days), so each purged table needs an index on that column alone, without tenant_id first.
-- Already indexed: moderation, feedback, review_answers, audit (at), threads (updated_at).
CREATE INDEX IF NOT EXISTS kv_created_at ON kv (created_at);
CREATE INDEX IF NOT EXISTS design_messages_created ON design_messages (created_at);
CREATE INDEX IF NOT EXISTS design_runs_created ON design_runs (created_at);
CREATE INDEX IF NOT EXISTS cases_created ON cases (created_at);
CREATE INDEX IF NOT EXISTS service_events_at ON service_events (at);
CREATE INDEX IF NOT EXISTS routine_notices_created ON routine_notices (created_at);
CREATE INDEX IF NOT EXISTS routine_approvals_created ON routine_approvals (created_at);
CREATE INDEX IF NOT EXISTS relay_envelopes_created ON relay_envelopes (created_at);
CREATE INDEX IF NOT EXISTS relay_beacons_updated ON relay_beacons (updated_at);
