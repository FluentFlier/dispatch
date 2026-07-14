-- Intelligence backend delta: RL hook scores, voice metrics EMA, post hook tracking.
-- Apply (requires InsForge CLI login + linked project):
--   npx @insforge/cli db import db/intelligence-backend.sql
-- Or run statements individually:
--   npx @insforge/cli db query "$(cat db/intelligence-backend.sql)"

-- Posts: hook RL loop needs which hooks were injected at generation time.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS used_hook_ids jsonb;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS rl_processed_at timestamptz;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pipeline_stages jsonb;

CREATE INDEX IF NOT EXISTS posts_rl_unprocessed
  ON posts (user_id, created_at DESC)
  WHERE used_hook_ids IS NOT NULL AND rl_processed_at IS NULL;

-- Learned hook performance (nightly intelligence-sync cron writes here).
CREATE TABLE IF NOT EXISTS hook_performance (
  hook_id text NOT NULL,
  vertical text NOT NULL,
  rl_score numeric NOT NULL DEFAULT 50,
  rl_confidence numeric NOT NULL DEFAULT 0.5,
  sample_count int NOT NULL DEFAULT 0,
  rl_updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (hook_id, vertical)
);

CREATE INDEX IF NOT EXISTS hook_performance_vertical_score
  ON hook_performance (vertical, rl_score DESC);

-- Workspace voice quality EMA (layer4_voice_metrics cron on publish).
CREATE TABLE IF NOT EXISTS workspace_voice_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  avg_voice_match_score numeric NOT NULL DEFAULT 0,
  avg_ai_score numeric NOT NULL DEFAULT 0,
  avg_persona_fidelity numeric NOT NULL DEFAULT 0,
  avg_uniqueness numeric NOT NULL DEFAULT 0,
  avg_specificity numeric NOT NULL DEFAULT 0,
  avg_so_what numeric NOT NULL DEFAULT 0,
  avg_pain_resonance numeric NOT NULL DEFAULT 0,
  post_count int NOT NULL DEFAULT 0,
  last_post_id uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (workspace_id, platform)
);

CREATE INDEX IF NOT EXISTS workspace_voice_metrics_lookup
  ON workspace_voice_metrics (workspace_id, platform);

ALTER TABLE workspace_voice_metrics ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY workspace_voice_metrics_select ON workspace_voice_metrics
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY workspace_voice_metrics_project_admin ON workspace_voice_metrics
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Feature flags (idempotent seeds - safe to re-run).
CREATE TABLE IF NOT EXISTS feature_flags (
  name text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  description text,
  updated_at timestamptz DEFAULT now() NOT NULL
);

INSERT INTO feature_flags (name, enabled, description) VALUES
  ('signals_engine', true, 'Signals sync cron (/api/cron/signals-sync)'),
  ('layer2_intelligence_sync', true, 'Hook RL nightly cron (/api/cron/intelligence-sync)'),
  ('layer3_memory_writes', true, 'Supermemory writes on publish'),
  ('layer4_voice_metrics', true, 'Voice metrics EMA on publish')
ON CONFLICT (name) DO NOTHING;
