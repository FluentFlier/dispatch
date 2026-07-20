-- Flag posts pulled from a connected account (historical imports) so the editor
-- can hide the pillar picker for them. Imported posts aren't authored against a
-- pillar; they carry the 'general' fallback only to satisfy the NOT NULL column.
-- Backfill treats existing posted 'general'-pillar rows as imported (the pre-flag
-- heuristic) - new imports set the flag explicitly at insert time.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_imported boolean NOT NULL DEFAULT false;

UPDATE posts
SET is_imported = true
WHERE status = 'posted' AND pillar = 'general' AND is_imported = false;
