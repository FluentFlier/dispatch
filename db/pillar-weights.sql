-- ============================================================================
-- Pillar weighting + multi-pillar ideas.
--
-- Adds per-pillar importance weights (1-100) so AI generation and hook
-- retrieval know which topics matter most ("mainly X, also touches Y, Z").
-- Also brings content_ideas up to the same multi-pillar model as posts.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfill only touches rows still at
-- the default, so re-running is harmless.
--
-- Backfill weights: primary pillar (pillars[0]) -> 70, secondary pillars -> 40.
-- ============================================================================

-- --- posts: per-pillar weights -------------------------------------------------
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pillar_weights jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE posts p
SET pillar_weights = sub.weights
FROM (
  SELECT id, jsonb_object_agg(slug, CASE WHEN ord = 1 THEN 70 ELSE 40 END) AS weights
  FROM (
    SELECT id, slug, row_number() OVER (PARTITION BY id) AS ord
    FROM posts, jsonb_array_elements_text(pillars) AS slug
    WHERE pillars IS NOT NULL AND jsonb_array_length(pillars) > 0
  ) ranked
  GROUP BY id
) sub
WHERE p.id = sub.id
  AND (p.pillar_weights IS NULL OR p.pillar_weights = '{}'::jsonb);

-- --- content_ideas: multi-pillar + weights -------------------------------------
ALTER TABLE content_ideas ADD COLUMN IF NOT EXISTS pillars jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE content_ideas ADD COLUMN IF NOT EXISTS pillar_weights jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE content_ideas
SET pillars = jsonb_build_array(pillar)
WHERE pillar IS NOT NULL
  AND (pillars IS NULL OR pillars = '[]'::jsonb);

UPDATE content_ideas
SET pillar_weights = jsonb_build_object(pillar, 70)
WHERE pillar IS NOT NULL
  AND (pillar_weights IS NULL OR pillar_weights = '{}'::jsonb);

-- GIN index so multi-pillar idea filtering (pillars @> '["slug"]') stays fast.
CREATE INDEX IF NOT EXISTS idx_content_ideas_pillars ON content_ideas USING gin (pillars);
