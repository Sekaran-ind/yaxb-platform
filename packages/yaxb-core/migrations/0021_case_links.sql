-- Dependencies between services (DEP-1..3): a case's links, as JSON: the case it was started for
-- (parent), the case it waits for (child, with when it stops waiting), the parent screen's `with:`
-- values (inputs: all the child is given), and the journeys its dependencies run, pinned at start.
ALTER TABLE cases ADD COLUMN links TEXT;
