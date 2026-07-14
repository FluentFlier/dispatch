-- Event research cross-workspace cache (idempotent)
--
-- WHY: public-event research (speakers, topics, announcements) is identical for
-- every user attending the same event. Keying research per event_capture_id means
-- 500 users at one conference pay for 500 identical scrapes + LLM extractions.
-- This table caches research by a normalized event identity so a popular event is
-- researched once and reused across all workspaces.
--
-- Stores ONLY public research facts - never workspace_id, user_id, or any tenant
-- identifier - so it is safe to share cross-workspace. Written and read solely by
-- the service client in the enrich cron; users never touch it directly.

CREATE TABLE IF NOT EXISTS event_research_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Normalized key: lower(title) | startDate(YYYY-MM-DD) | lower(location).
  research_key text NOT NULL UNIQUE,
  summary text NOT NULL DEFAULT '',
  speakers jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_announcements jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_text text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Freshness lookups filter on updated_at (30-day window in code).
CREATE INDEX IF NOT EXISTS event_research_cache_updated ON event_research_cache (updated_at DESC);

ALTER TABLE event_research_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_research_cache FORCE ROW LEVEL SECURITY;

-- No user/workspace policies: this table has no tenant column and is accessed only
-- by the service role. project_admin (service client) gets full access; everyone
-- else is denied by default (RLS on, no permissive policy).
DO $$ BEGIN
  CREATE POLICY event_research_cache_project_admin ON event_research_cache
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER event_research_cache_updated_at
    BEFORE UPDATE ON event_research_cache
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
