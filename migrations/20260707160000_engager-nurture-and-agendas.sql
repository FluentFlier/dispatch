-- Engager nurture + agenda layer.
--
-- WHY: post engagers (people who liked/commented on YOUR posts, stored in
-- warm_contacts) only ever got a connect draft — no research, no comment-first
-- warmup, no DM follow-up, and they never flowed through the same nurture state
-- machine directory leads use. This migration promotes warm_contacts to a
-- first-class nurtured "person" that runs the full research -> comment ->
-- connect -> DM sequence on the existing engagement_tasks queue + safety
-- envelope, and turns signal_icp_profiles into full "agendas" (a goal with its
-- own pitch angle, tone rules, and daily caps) so one workspace can run several
-- outreach goals in parallel (e.g. "land an internship" vs "win banking
-- customers").
--
-- Accessed by the user-scoped server client (RLS: user_id = auth.uid()) and by
-- the service client on cron paths (project_admin bypass).

-- --- Agenda config on ICP profiles -------------------------------------------
-- goal_type drives which playbook angle + copy rules the drafters use.
ALTER TABLE signal_icp_profiles
  ADD COLUMN IF NOT EXISTS goal_type text NOT NULL DEFAULT 'networking';

ALTER TABLE signal_icp_profiles
  ADD COLUMN IF NOT EXISTS target_personas jsonb NOT NULL DEFAULT '[]';

-- One-line angle for outreach ("helpful founder peer", not "buy our product").
ALTER TABLE signal_icp_profiles
  ADD COLUMN IF NOT EXISTS pitch_angle text;

-- Freeform tone/voice rules layered on top of the creator voice for this goal.
ALTER TABLE signal_icp_profiles
  ADD COLUMN IF NOT EXISTS tone_rules text;

-- Per-agenda human-paced caps (worker still enforces global safety on top).
ALTER TABLE signal_icp_profiles
  ADD COLUMN IF NOT EXISTS daily_connect_limit integer NOT NULL DEFAULT 5;

ALTER TABLE signal_icp_profiles
  ADD COLUMN IF NOT EXISTS daily_comment_limit integer NOT NULL DEFAULT 5;

-- Which lead sources this agenda draws from: engagers | directory | signals.
ALTER TABLE signal_icp_profiles
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '["engagers","directory","signals"]';

-- --- Nurture state on warm_contacts (engagers) -------------------------------
-- Same vocabulary as signal_leads.nurture_stage so both share the state machine.
ALTER TABLE warm_contacts
  ADD COLUMN IF NOT EXISTS nurture_stage text NOT NULL DEFAULT 'discovered';

ALTER TABLE warm_contacts
  ADD COLUMN IF NOT EXISTS playbook jsonb;

ALTER TABLE warm_contacts
  ADD COLUMN IF NOT EXISTS next_action_at timestamptz;

-- LLM research dossier: who they are, why they matter, suggested angle.
ALTER TABLE warm_contacts
  ADD COLUMN IF NOT EXISTS dossier text;

ALTER TABLE warm_contacts
  ADD COLUMN IF NOT EXISTS dossier_json jsonb;

-- Agenda assignment (nullable: an engager can be un-assigned / triage only).
ALTER TABLE warm_contacts
  ADD COLUMN IF NOT EXISTS icp_profile_id uuid;

ALTER TABLE warm_contacts
  ADD COLUMN IF NOT EXISTS goal_type text;

-- Prioritization: ICP fit x engagement depth, surfaced as the feed sort key.
ALTER TABLE warm_contacts
  ADD COLUMN IF NOT EXISTS priority_score numeric NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE warm_contacts
    ADD CONSTRAINT warm_contacts_nurture_stage_check
    CHECK (nurture_stage IN (
      'discovered', 'planned', 'engaging', 'connect_ready',
      'connect_sent', 'nurturing', 'dm_ready', 'dm_sent', 'replied', 'closed'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS warm_contacts_nurture_due
  ON warm_contacts (workspace_id, nurture_stage, next_action_at)
  WHERE nurture_stage IN ('connect_ready', 'dm_ready');

-- --- Link engagement tasks back to the engager they warm up ------------------
ALTER TABLE engagement_tasks
  ADD COLUMN IF NOT EXISTS warm_contact_id uuid;

CREATE INDEX IF NOT EXISTS engagement_tasks_warm_contact
  ON engagement_tasks (warm_contact_id);

COMMENT ON COLUMN engagement_tasks.source IS
  'manual | signal | gtm_nurture | engager_nurture | lead_manual';
