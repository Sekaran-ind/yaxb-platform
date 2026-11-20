-- A service's retention period (build step 2 of "Data lifetime and trust"): how many days every record
-- the service captures on the server is kept, counted from creation. The author sets it in the service
-- design. Absent: 30 days. Only the paid plan honours it (the free plan deletes at 30 days whatever it says).
ALTER TABLE library_entries ADD COLUMN retain_days INTEGER;
