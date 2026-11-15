-- A join link that needs no decision (TEN-8): only the first administrator's, which the
-- deployment's administrator hands over when adding a business.
ALTER TABLE join_tokens ADD COLUMN auto_accept INTEGER NOT NULL DEFAULT 0;
