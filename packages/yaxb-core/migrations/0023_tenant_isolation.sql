-- Businesses in one edition no longer share these (Phase 0): the moderation queue, answers sent for
-- review, feedback, the Service Designer's threads, runs and lessons, and services' events each belong
-- to the business (tenant) whose visitors, members or services made them. What exists already belongs
-- to the 'default' business, as everything did before tenants.
ALTER TABLE moderation ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS moderation_tenant ON moderation (tenant_id, created_at);
ALTER TABLE review_answers ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS review_answers_tenant ON review_answers (tenant_id, created_at);
ALTER TABLE feedback ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS feedback_tenant ON feedback (tenant_id, created_at);
ALTER TABLE design_messages ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE design_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE design_lessons ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS design_lessons_tenant ON design_lessons (tenant_id, created_at);
ALTER TABLE service_events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS service_events_tenant ON service_events (tenant_id, service, at);
