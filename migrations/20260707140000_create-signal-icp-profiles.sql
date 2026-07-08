-- Multiple saved ICPs per workspace.
--
-- WHY: an ICP used to be a single set of fields on signal_directory_settings
-- (icp_description / icp_verticals / icp_keywords), so a workspace could only
-- ever describe one ideal customer. Teams sell into several segments, so we now
-- keep named ICP profiles here and treat signal_directory_settings as a mirror
-- of the ACTIVE profile — the whole discovery/scoring/digest pipeline still reads
-- directory_settings unchanged. Activating a profile copies its fields there;
-- "Save ICP" snapshots the current working ICP into a named profile; and lead
-- discovery can run against any set of selected profiles (see /api/leads/icp/discover).
--
-- Accessed by the user-scoped server client (workspace-member RLS) and by the
-- service client on cron paths (project_admin bypass) — mirrors signals-leads-rls.sql.

CREATE TABLE IF NOT EXISTS signal_icp_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  -- jsonb arrays to match the existing icp_* columns on signal_directory_settings.
  verticals jsonb NOT NULL DEFAULT '[]',
  keywords jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS signal_icp_profiles_workspace
  ON signal_icp_profiles (workspace_id, created_at DESC);

-- At most one active profile per workspace (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS signal_icp_profiles_one_active
  ON signal_icp_profiles (workspace_id)
  WHERE is_active;

ALTER TABLE signal_icp_profiles ENABLE ROW LEVEL SECURITY;

-- Member policy: a user can read/write ICPs for workspaces they belong to.
DO $$ BEGIN
  CREATE POLICY signal_icp_profiles_member ON signal_icp_profiles FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  ) WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Project-admin bypass (server/cron paths).
DO $$ BEGIN
  CREATE POLICY signal_icp_profiles_admin ON signal_icp_profiles
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER signal_icp_profiles_updated_at
    BEFORE UPDATE ON signal_icp_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
