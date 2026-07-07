-- Workspace-scoped outreach edit history (idempotent)
--
-- WHY: when a user rewrites a generated outreach draft before sending, that
-- edit is the strongest available signal of their real voice/preferences. We
-- persist the model draft -> user-edited pair per workspace so future draft
-- prompts can few-shot on "how this user rewrites drafts" and stop repeating a
-- generic template. Workspace-scoped so it persists across sessions.
--
-- Written + read only by the service client (like the other signal_* tables),
-- always filtered by workspace_id; RLS is deferred to the workspace migration.

CREATE TABLE IF NOT EXISTS signal_outreach_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  lead_id uuid,
  original_text text NOT NULL DEFAULT '',
  edited_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_outreach_edits_ws_created
  ON signal_outreach_edits (workspace_id, created_at DESC);
