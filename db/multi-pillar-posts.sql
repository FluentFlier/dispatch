-- Phase B: multiple pillars per post.
-- Adds a `pillars` jsonb array while keeping the existing single `pillar` column
-- as the synced primary (pillars[0]) for backward compatibility. Every existing
-- reader that uses `posts.pillar` keeps working unchanged.
--
-- Run once in the InsForge SQL editor.

-- 1. Add the array column (default empty array).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pillars jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Backfill from the existing single pillar for all rows that don't have an
--    array yet. A post with pillar 'ai' becomes pillars ["ai"].
UPDATE posts
SET pillars = jsonb_build_array(pillar)
WHERE pillar IS NOT NULL
  AND pillar <> ''
  AND (pillars IS NULL OR pillars = '[]'::jsonb);

-- 3. (Optional) index for filtering posts by a contained pillar.
CREATE INDEX IF NOT EXISTS idx_posts_pillars ON posts USING gin (pillars);

-- Verify
SELECT id, pillar, pillars FROM posts LIMIT 10;
