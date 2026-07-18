-- Series Planning: grounded, resource-fed multi-part series with auto-publish.
--
-- Additive only. Extends `series`, adds `series_sources` (dropped resource
-- material) + `series_chunks` (embedded, retrievable), a per-part approval flag
-- on posts, and match_series_chunks() for pgvector retrieval scoped to one series.
-- Every new table carries user_id + workspace_id and is RLS-scoped to the
-- caller's workspace, mirroring signal_leads. Idempotent; safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

-- --- series: planning + scheduling metadata ---------------------------------
ALTER TABLE series ADD COLUMN IF NOT EXISTS platform       TEXT;
ALTER TABLE series ADD COLUMN IF NOT EXISTS cadence        JSONB;
ALTER TABLE series ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE series ADD COLUMN IF NOT EXISTS auto_publish   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE series ADD COLUMN IF NOT EXISTS source_summary TEXT;

-- --- posts: per-part approval gate (auto-publish never fires unapproved) -----
-- The posts.status check constraint is fixed (idea|scripted|filmed|edited|posted),
-- so approval is a dedicated boolean rather than an overloaded status value.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS series_approved BOOLEAN NOT NULL DEFAULT false;

-- --- series_sources: one row per dropped resource ---------------------------
CREATE TABLE IF NOT EXISTS series_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id    UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  workspace_id UUID,
  kind         TEXT NOT NULL,                       -- file | text | url | story_bank | post
  title        TEXT,
  source_ref   TEXT,                                -- url / storage path / entity id
  raw_text     TEXT NOT NULL DEFAULT '',
  char_count   INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending',     -- pending | ready | failed
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS series_sources_series ON series_sources (series_id);

-- --- series_chunks: embedded, retrievable slices of the dropped material -----
CREATE TABLE IF NOT EXISTS series_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id    UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  source_id    UUID NOT NULL REFERENCES series_sources(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  workspace_id UUID,
  chunk_index  INT NOT NULL DEFAULT 0,
  content      TEXT NOT NULL,
  embedding    VECTOR(512),                         -- same space as niche/hook RAG
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Chunk sets are small per series, so a btree on series_id + an exact cosine scan
-- is enough; no ANN index needed until a single series holds thousands of chunks.
CREATE INDEX IF NOT EXISTS series_chunks_series ON series_chunks (series_id);

-- --- RLS: workspace-member read/write + project_admin (service) bypass -------
ALTER TABLE series_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE series_chunks  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY series_sources_member ON series_sources FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  ) WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY series_sources_admin ON series_sources FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY series_chunks_member ON series_chunks FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  ) WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY series_chunks_admin ON series_chunks FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- match_series_chunks: cosine retrieval scoped to one series -------------
-- p_query_embedding arrives as a pgvector text literal ('[0.1,...]') and is cast
-- inside, so the SDK never marshals a vector type. LANGUAGE sql STABLE runs with
-- the caller's rights, so RLS on series_chunks is a second isolation layer on top
-- of the explicit series_id filter. Distance <=> is (1 - cosine_similarity) for
-- L2-normalized OpenAI embeddings, so similarity = 1 - distance.
CREATE OR REPLACE FUNCTION match_series_chunks(
  p_series_id UUID,
  p_query_embedding TEXT,
  p_limit INT DEFAULT 8
) RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity REAL
) LANGUAGE sql STABLE AS $$
  SELECT
    sc.id,
    sc.content,
    (1 - (sc.embedding <=> p_query_embedding::vector(512)))::REAL AS similarity
  FROM series_chunks sc
  WHERE sc.series_id = p_series_id
    AND sc.embedding IS NOT NULL
  ORDER BY sc.embedding <=> p_query_embedding::vector(512)
  LIMIT p_limit;
$$;
