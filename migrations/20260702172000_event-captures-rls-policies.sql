-- Event captures row-level security policies (idempotent)
--
-- WHY: event_captures had RLS enabled but ZERO policies, which is deny-all for the
-- authenticated (non-service) role. The manual calendar reload and the
-- /api/event-capture read path both use the user-scoped client, so inserts were
-- rejected (Postgres 42501 "violates row-level security policy") and reads
-- returned nothing. This table was missed in the user_id RLS rollout that covers
-- the other tenant tables (e.g. posts). Mirror the posts policies so a user can
-- read/write only their OWN captures; the hourly sync + enrich crons keep writing
-- via the service client, which bypasses RLS.
--
-- These policies were already applied to the live InsForge database during
-- debugging; this migration records them so fresh environments and prod stay in
-- sync. Safe to re-run.

ALTER TABLE event_captures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_captures_select ON event_captures;
CREATE POLICY event_captures_select ON event_captures
  FOR SELECT TO public USING (user_id = auth.uid());

DROP POLICY IF EXISTS event_captures_insert ON event_captures;
CREATE POLICY event_captures_insert ON event_captures
  FOR INSERT TO public WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS event_captures_update ON event_captures;
CREATE POLICY event_captures_update ON event_captures
  FOR UPDATE TO public USING (user_id = auth.uid());

DROP POLICY IF EXISTS event_captures_delete ON event_captures;
CREATE POLICY event_captures_delete ON event_captures
  FOR DELETE TO public USING (user_id = auth.uid());
