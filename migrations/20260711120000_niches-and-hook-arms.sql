-- Niche Hook Intelligence: dynamic per-user niches + Thompson-sampling arms +
-- semantic hook columns. Shared-intelligence tables (no user PII): service role
-- writes, authenticated users read. Idempotent; safe to re-run.
--
-- pgvector is required for the 512-dim embeddings and the cosine (<=>) blend in
-- match_niche_hooks. text-embedding-3-small is L2-normalized, so cosine distance
-- <=> maps to (1 - cosine_similarity).

CREATE EXTENSION IF NOT EXISTS vector;

-- --- niches (spec 2.1) -------------------------------------------------------
CREATE TABLE IF NOT EXISTS niches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  embedding VECTOR(512),
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | mining | active | merged
  merged_into UUID REFERENCES niches(id),
  seed_keywords TEXT[] NOT NULL DEFAULT '{}',
  active_user_count INT NOT NULL DEFAULT 0,
  last_mined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS niches_status ON niches (status);

-- --- hook_examples new columns (spec 2.1) -----------------------------------
ALTER TABLE hook_examples ADD COLUMN IF NOT EXISTS niche_id UUID REFERENCES niches(id);
ALTER TABLE hook_examples ADD COLUMN IF NOT EXISTS embedding VECTOR(512);
ALTER TABLE hook_examples ADD COLUMN IF NOT EXISTS pattern_class TEXT;
ALTER TABLE hook_examples ADD COLUMN IF NOT EXISTS ai_likelihood REAL;
ALTER TABLE hook_examples ADD COLUMN IF NOT EXISTS norm_engagement REAL;
ALTER TABLE hook_examples ADD COLUMN IF NOT EXISTS internal_uses_7d INT DEFAULT 0;
CREATE INDEX IF NOT EXISTS hook_examples_niche ON hook_examples (niche_id);

-- --- hook_arms: Thompson state (spec 2.1) -----------------------------------
CREATE TABLE IF NOT EXISTS hook_arms (
  niche_id UUID REFERENCES niches(id),
  hook_id TEXT NOT NULL,
  alpha REAL NOT NULL DEFAULT 1,
  beta  REAL NOT NULL DEFAULT 1,
  pulls INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (niche_id, hook_id)
);

-- --- creator_profile niche assignment ---------------------------------------
ALTER TABLE creator_profile ADD COLUMN IF NOT EXISTS niche_id UUID REFERENCES niches(id);
ALTER TABLE creator_profile ADD COLUMN IF NOT EXISTS niche_confidence REAL;

-- --- RLS: service write, authenticated read ---------------------------------
ALTER TABLE niches ENABLE ROW LEVEL SECURITY;
ALTER TABLE hook_arms ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY niches_project_admin ON niches FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY niches_auth_read ON niches FOR SELECT TO public USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY hook_arms_project_admin ON hook_arms FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY hook_arms_auth_read ON hook_arms FOR SELECT TO public USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- hook_examples is an existing shared table (created in db/hooks-intelligence.sql
-- with no RLS). Enabling service-write + authenticated-read here brings it in line
-- with the other mined tables. Existing service-role writers are unaffected.
ALTER TABLE hook_examples ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY hook_examples_project_admin ON hook_examples FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY hook_examples_auth_read ON hook_examples FOR SELECT TO public USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- match_niche_hooks: candidate blend (spec 2.4.1) ------------------------
-- Blend = 0.5 * cosine_sim(topic) + 0.3 * norm_engagement + 0.2 * freshness,
-- freshness = exp(-ln(2) * age_days / 17.5) (half-life 17.5 days).
-- p_topic_embedding is passed as a pgvector text literal ('[0.1,0.2,...]') and
-- cast inside, so the SDK never has to marshal a vector type. Filters: this
-- niche only, non-bait, under the burn-out cap.
CREATE OR REPLACE FUNCTION match_niche_hooks(
  p_niche_id UUID,
  p_topic_embedding TEXT,
  p_limit INT DEFAULT 24
) RETURNS TABLE (
  hook_id TEXT,
  hook_text TEXT,
  alpha REAL,
  beta REAL,
  blend REAL
) LANGUAGE sql STABLE AS $$
  SELECT
    he.id AS hook_id,
    he.text AS hook_text,
    COALESCE(ha.alpha, 1)::REAL AS alpha,
    COALESCE(ha.beta, 1)::REAL AS beta,
    ( 0.5 * (1 - (he.embedding <=> p_topic_embedding::vector(512)))
    + 0.3 * COALESCE(he.norm_engagement, 0)
    + 0.2 * exp(-ln(2) * (EXTRACT(EPOCH FROM (now() - he.mined_at)) / 86400.0) / 17.5)
    )::REAL AS blend
  FROM hook_examples he
  LEFT JOIN hook_arms ha ON ha.niche_id = he.niche_id AND ha.hook_id = he.id
  WHERE he.niche_id = p_niche_id
    AND he.embedding IS NOT NULL
    AND (he.pattern_class IS NULL OR he.pattern_class <> 'bait')
    AND COALESCE(he.internal_uses_7d, 0) < 25
  ORDER BY blend DESC
  LIMIT p_limit;
$$;
