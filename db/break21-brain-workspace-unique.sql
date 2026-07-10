-- Break 21: scope creator_brain_pages uniqueness by workspace.
--
-- Before: UNIQUE (user_id, slug) — a user in two workspaces sharing a slug had
-- the second workspace's putBrainPage upsert overwrite the first workspace's page.
-- After:  UNIQUE NULLS NOT DISTINCT (user_id, workspace_id, slug) — each workspace
-- keeps its own page per slug, and the code upsert onConflict target matches.
--
-- Applied to the live InsForge backend 2026-07-09 (PG 15.18). Idempotent; safe to
-- re-run. 0 duplicate triples existed at migration time, so no data was lost.
-- Applied statement-by-statement (the backend rejects BEGIN/COMMIT); run in this
-- order so there is never a window without a unique constraint.

-- 1. Backfill any null workspace_id from the user's solo workspace.
UPDATE creator_brain_pages cbp
SET workspace_id = w.id
FROM workspaces w
WHERE w.owner_user_id = cbp.user_id
  AND w.type = 'solo'
  AND cbp.workspace_id IS NULL;

-- 2. Add the workspace-scoped unique. NULLS NOT DISTINCT (PG15+) so any future
--    null-workspace row still cannot duplicate a (user_id, slug) pair and ON
--    CONFLICT inference matches.
ALTER TABLE creator_brain_pages
  ADD CONSTRAINT creator_brain_pages_user_ws_slug_key
  UNIQUE NULLS NOT DISTINCT (user_id, workspace_id, slug);

-- 3. Drop the old (user_id, slug) unique.
ALTER TABLE creator_brain_pages
  DROP CONSTRAINT IF EXISTS creator_brain_pages_user_id_slug_key;
