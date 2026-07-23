-- Write page @mentions: LinkedIn people tagged in a draft, resolved through
-- Unipile people-search. Shape: [{"name": "...", "profile_id": "..."}].
-- Carried on the post row so queued/scheduled publishes keep their mentions
-- (the publish job rebuilds its payload from the row).
alter table posts add column if not exists mentions jsonb;
