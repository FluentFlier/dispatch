-- Evolving model delta: closes the learning flywheel (edit feedback, watchlists, loop telemetry).
-- Apply after hooks-intelligence.sql + intelligence-backend.sql:
--   bash scripts/apply-all-intelligence.sh

-- Human edit feedback log (audit trail + magnitude for RL penalties).
CREATE TABLE IF NOT EXISTS edit_feedback_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid,
  post_id uuid,
  hook_ids text[] DEFAULT '{}',
  vertical text,
  magnitude numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS edit_feedback_log_user ON edit_feedback_log (user_id, created_at DESC);

ALTER TABLE edit_feedback_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY edit_feedback_log_project_admin ON edit_feedback_log
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Per-workspace hook mining watchlist (replaces global-only DEFAULT_WATCHLIST over time).
CREATE TABLE IF NOT EXISTS workspace_watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  handle text NOT NULL,
  platform text NOT NULL DEFAULT 'x',
  verticals text[] NOT NULL DEFAULT '{}',
  priority int NOT NULL DEFAULT 5,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (workspace_id, handle, platform)
);

CREATE INDEX IF NOT EXISTS workspace_watchlists_lookup
  ON workspace_watchlists (workspace_id, enabled, priority DESC);

ALTER TABLE workspace_watchlists ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY workspace_watchlists_project_admin ON workspace_watchlists
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Voice drift baseline snapshot (onboarding persona fidelity reference).
CREATE TABLE IF NOT EXISTS voice_drift_baselines (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'all',
  baseline_persona_fidelity numeric NOT NULL,
  baseline_ai_slop numeric NOT NULL DEFAULT 5,
  captured_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (workspace_id, platform)
);

ALTER TABLE voice_drift_baselines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY voice_drift_baselines_project_admin ON voice_drift_baselines
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Layer 1 + loop feature flags (idempotent).
INSERT INTO feature_flags (name, enabled, description) VALUES
  ('layer1_event_enrich', true, 'Event capture enrichment cron'),
  ('layer1_calendar_sync', true, 'Calendar sync cron'),
  ('layer1_draft_generation', true, 'Auto-draft on event capture'),
  ('loop_engagement_categorize', true, 'Categorize engagers into lead_categories'),
  ('loop_social_listening', true, 'Daily Apify social listening via intelligence/run')
ON CONFLICT (name) DO NOTHING;
