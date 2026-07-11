-- Event capture core tables (missing from earlier migrations which only added RLS).
-- Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'google',
  composio_connected_account_id text,
  calendar_id text,
  calendar_name text,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS calendar_connections_workspace_idx
  ON calendar_connections (workspace_id);
CREATE INDEX IF NOT EXISTS calendar_connections_user_idx
  ON calendar_connections (user_id);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  workspace_id uuid,
  user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed','cancelled')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_status_type_idx ON jobs (status, type);
CREATE INDEX IF NOT EXISTS jobs_workspace_idx ON jobs (workspace_id);

CREATE TABLE IF NOT EXISTS event_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  calendar_connection_id uuid REFERENCES calendar_connections(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'google',
  provider_event_id text NOT NULL,
  title text NOT NULL,
  description text,
  location text,
  attendees jsonb,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  event_type text NOT NULL DEFAULT 'other',
  is_public_event boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'detected',
  questions jsonb,
  answers jsonb,
  draft_post_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (workspace_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS event_captures_workspace_status_idx
  ON event_captures (workspace_id, status);
CREATE INDEX IF NOT EXISTS event_captures_user_idx
  ON event_captures (user_id);
CREATE INDEX IF NOT EXISTS event_captures_end_time_idx
  ON event_captures (end_time DESC);

ALTER TABLE event_captures ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY event_captures_select ON event_captures
    FOR SELECT TO public USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY event_captures_insert ON event_captures
    FOR INSERT TO public WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY event_captures_update ON event_captures
    FOR UPDATE TO public USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY event_captures_delete ON event_captures
    FOR DELETE TO public USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY calendar_connections_select ON calendar_connections
    FOR SELECT TO public USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calendar_connections_insert ON calendar_connections
    FOR INSERT TO public WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calendar_connections_update ON calendar_connections
    FOR UPDATE TO public USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calendar_connections_delete ON calendar_connections
    FOR DELETE TO public USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
