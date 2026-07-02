-- Profile snapshots for role_change detection.
--
-- WHY: the spec wants job-title/experience changes on tracked person profiles to
-- surface as role_change signals. We snapshot each tracked profile's headline
-- (the LinkedIn tagline, where role + company live) and diff it on each poll. A
-- changed headline vs the stored baseline => a role_change signal. First sight of
-- a profile stores a baseline only (no signal without a prior to compare against).
--
-- Written and read only by the service client in the signals-sync cron.

CREATE TABLE IF NOT EXISTS signal_profile_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('x', 'linkedin')),
  -- Normalized public identifier of the tracked profile (e.g. LinkedIn public id).
  profile_key text NOT NULL,
  provider_id text,
  full_name text,
  headline text,
  captured_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (workspace_id, platform, profile_key)
);

CREATE INDEX IF NOT EXISTS signal_profile_snapshots_ws
  ON signal_profile_snapshots (workspace_id);

ALTER TABLE signal_profile_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_profile_snapshots FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY signal_profile_snapshots_project_admin
    ON signal_profile_snapshots FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER signal_profile_snapshots_updated_at
    BEFORE UPDATE ON signal_profile_snapshots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
